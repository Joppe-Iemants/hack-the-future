import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, getDocs, updateDoc, deleteDoc, collection, writeBatch, serverTimestamp, Timestamp, arrayUnion} from 'firebase/firestore';
import {weekIdOf, addWeeks} from '../dist/play-time.mjs';

// Firestore-regels kennen geen tijdzones en aanvaarden daarom de weekgrens met één uur marge. Alleen
// in dat uur rond de weekwissel (zondag 23:00 – maandag 01:00) kunnen de "vorige/volgende week"-tests afwijken.
let environment;
const week = weekIdOf(Date.now()), lastWeek = addWeeks(week, -1), nextWeek = addWeeks(week, 1);
const DAY = 86400000;
const TOKEN = 'T0kenT0kenT0kenT0kenT0ken12';

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-loopcade',
    firestore: {host: '127.0.0.1', port: 8080, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')},
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => { await environment?.clearFirestore(); });

const as = uid => environment.authenticatedContext(uid).firestore();
const start = {name: 'Korenmarkt, Gent', lon: 3.7219, lat: 51.05442};
const groupData = (ownerUid, extra = {}) => ({
  schemaVersion: 1, name: 'Vrienden', mode: 'territory', ownerUid, start, firstWeek: week, createdAt: serverTimestamp(), ...extra,
});
const ownerMember = (uid, extra = {}) => ({uid, displayName: 'Eigenaar', role: 'owner', joinedAt: serverTimestamp(), ...extra});
const playerMember = (uid, extra = {}) => ({uid, displayName: 'Speler', role: 'player', joinedAt: serverTimestamp(), inviteId: TOKEN, ...extra});
const inviteData = (uid, extra = {}) => ({
  createdBy: uid, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY), active: true,
  groupName: 'Vrienden', startName: 'Korenmarkt, Gent', ownerName: 'Eigenaar', ...extra,
});
const playerWeek = (uid, cells, weekId = week, extra = {}) => ({uid, weekId, cells, updatedAt: serverTimestamp(), ...extra});

async function createGroup(db, uid, groupId = 'g1', group = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'groups', groupId), groupData(uid, group));
  batch.set(doc(db, 'groups', groupId, 'members', uid), ownerMember(uid));
  return batch.commit();
}

// Zet een volledige groep klaar zonder regels: eigenaar "owner" en spelers "alice" en "bob".
async function seedGroup({players = ['alice', 'bob'], firstWeek = week, invite = {}} = {}) {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'groups/g1'), {schemaVersion: 1, name: 'Vrienden', mode: 'territory', ownerUid: 'owner', start, firstWeek, createdAt: Timestamp.now()});
    await setDoc(doc(db, 'groups/g1/members/owner'), {uid: 'owner', displayName: 'Eigenaar', role: 'owner', joinedAt: Timestamp.now()});
    for (const uid of players) await setDoc(doc(db, 'groups/g1/members/' + uid), {uid, displayName: uid, role: 'player', joinedAt: Timestamp.now(), inviteId: TOKEN});
    await setDoc(doc(db, 'groups/g1/invites/' + TOKEN), {
      createdBy: 'owner', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY), active: true,
      groupName: 'Vrienden', startName: 'Korenmarkt, Gent', ownerName: 'Eigenaar', ...invite,
    });
  });
}

test('een ingelogde gebruiker maakt een groep en wordt zelf eigenaar en lid', async () => {
  const db = as('owner');
  await assertSucceeds(createGroup(db, 'owner'));
  const snapshot = await assertSucceeds(getDoc(doc(db, 'groups/g1')));
  assert.equal(snapshot.data().ownerUid, 'owner');
  assert.equal((await assertSucceeds(getDoc(doc(db, 'groups/g1/members/owner')))).data().role, 'owner');
});

test('een groep met ongeldige gegevens of een vreemde eigenaar wordt geweigerd', async () => {
  const db = as('owner');
  await assertFails(createGroup(db, 'owner', 'g-leeg', {name: ''}));
  await assertFails(createGroup(db, 'owner', 'g-lang', {name: 'x'.repeat(41)}));
  await assertFails(createGroup(db, 'owner', 'g-mode', {mode: 'onbekend'}));
  await assertFails(createGroup(db, 'owner', 'g-week', {firstWeek: lastWeek}));
  await assertFails(createGroup(db, 'owner', 'g-extra', {isAdmin: true}));
  await assertFails(createGroup(db, 'owner', 'g-start', {start: {name: 'X', lon: 999, lat: 51}}));
  await assertFails(createGroup(db, 'owner', 'g-tijd', {createdAt: Timestamp.fromMillis(Date.now() - 1000)}));
  await assertFails(setDoc(doc(db, 'groups/g-vreemd'), groupData('someone-else')), 'eigenaar moet jezelf zijn');
  await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'groups/g3'), groupData('x')), 'niet ingelogd');
});

test('een eigenaar-lid kan alleen samen met het aanmaken van de groep ontstaan', async () => {
  await seedGroup({players: []});
  const mallory = as('mallory');
  await assertFails(setDoc(doc(mallory, 'groups/g1/members/mallory'), ownerMember('mallory')), 'eigenaar worden van een bestaande groep');
  await assertFails(setDoc(doc(as('owner'), 'groups/g1/members/owner'), ownerMember('owner')), 'opnieuw eigenaar-lid maken');
  await assertFails(setDoc(doc(mallory, 'groups/g-nieuw/members/mallory'), ownerMember('mallory')), 'eigenaar-lid zonder groep');
});

test('niet-leden en niet-ingelogde gebruikers kunnen een groep niet lezen', async () => {
  await seedGroup();
  const outsider = as('outsider');
  await assertFails(getDoc(doc(outsider, 'groups/g1')));
  await assertFails(getDoc(doc(outsider, 'groups/g1/members/owner')));
  await assertFails(getDocs(collection(outsider, 'groups/g1/members')));
  await assertFails(getDocs(collection(outsider, `groups/g1/weeks/${week}/players`)));
  await assertFails(getDocs(collection(outsider, 'groups/g1/results')));
  await assertFails(getDocs(collection(outsider, 'groups/g1/invites')));
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymous, 'groups/g1')));
  await assertFails(getDoc(doc(anonymous, 'groups/g1/invites/' + TOKEN)));
  await assertSucceeds(getDoc(doc(as('alice'), 'groups/g1')));
});

test('de groep zelf is na het aanmaken onveranderlijk en kan niet worden verwijderd', async () => {
  await seedGroup();
  const owner = as('owner');
  await assertFails(updateDoc(doc(owner, 'groups/g1'), {name: 'Nieuw'}));
  await assertFails(updateDoc(doc(owner, 'groups/g1'), {ownerUid: 'alice'}));
  await assertFails(deleteDoc(doc(owner, 'groups/g1')));
});

test('een geldige uitnodiging werkt voor een nieuwe speler; de uitnodiging openen vereist het token', async () => {
  await seedGroup({players: []});
  const carol = as('carol');
  const invite = await assertSucceeds(getDoc(doc(carol, 'groups/g1/invites/' + TOKEN)));
  assert.equal(invite.data().groupName, 'Vrienden');
  await assertFails(getDocs(collection(carol, 'groups/g1/invites')));
  await assertFails(getDoc(doc(carol, 'groups/g1/members/owner')));
  const batch = writeBatch(carol);
  batch.set(doc(carol, 'groups/g1/members/carol'), playerMember('carol'));
  batch.set(doc(carol, 'users/carol/playGroups/g1'), {groupId: 'g1', name: 'Vrienden', joinedAt: serverTimestamp()});
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(carol, 'groups/g1')));
  await assertSucceeds(getDocs(collection(carol, 'groups/g1/members')));
});

test('deelname mislukt met een onbekend, verlopen of ingetrokken token', async () => {
  await seedGroup({players: [], invite: {expiresAt: Timestamp.fromMillis(Date.now() - 1000)}});
  const carol = as('carol');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol')), 'verlopen');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {inviteId: 'Onbekend0Onbekend0Onbekend'})), 'onbekend');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {inviteId: '../../x'})), 'padinjectie');
  await environment.clearFirestore();
  await seedGroup({players: [], invite: {active: false}});
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol')), 'ingetrokken');
  await environment.clearFirestore();
  await seedGroup({players: []});
  await assertSucceeds(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol')));
});

test('deelname kan niet voor een ander, niet als eigenaar en niet met extra velden', async () => {
  await seedGroup({players: []});
  const carol = as('carol');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/dave'), playerMember('dave')), 'ander uid');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {role: 'owner'})), 'zelf eigenaar maken');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), {...ownerMember('carol')}), 'eigenaar zonder token');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {admin: true})), 'extra veld');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {displayName: ''})), 'lege naam');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {displayName: 'x'.repeat(31)})), 'te lange naam');
  await assertFails(setDoc(doc(carol, 'groups/g1/members/carol'), playerMember('carol', {joinedAt: Timestamp.fromMillis(1)})), 'valse tijd');
});

test('alleen de eigenaar maakt en trekt uitnodigingen in', async () => {
  await seedGroup();
  const owner = as('owner'), alice = as('alice');
  const token = 'NieuweUitnodiging0123456789';
  await assertSucceeds(setDoc(doc(owner, 'groups/g1/invites/' + token), inviteData('owner')));
  await assertFails(setDoc(doc(alice, 'groups/g1/invites/' + token + 'x'), inviteData('alice')), 'speler maakt geen uitnodiging');
  await assertFails(setDoc(doc(owner, 'groups/g1/invites/kort'), inviteData('owner')), 'te kort token');
  await assertFails(setDoc(doc(owner, 'groups/g1/invites/' + token + 'y'), inviteData('owner', {expiresAt: Timestamp.fromMillis(Date.now() + 90 * DAY)})), 'te lang geldig');
  await assertFails(setDoc(doc(owner, 'groups/g1/invites/' + token + 'z'), inviteData('owner', {createdBy: 'alice'})));
  assert.equal((await assertSucceeds(getDocs(collection(alice, 'groups/g1/invites')))).size, 2, 'leden zien de uitnodigingen');
  await assertFails(updateDoc(doc(alice, 'groups/g1/invites/' + token), {active: false}));
  await assertFails(updateDoc(doc(owner, 'groups/g1/invites/' + token), {expiresAt: Timestamp.fromMillis(Date.now() + 20 * DAY)}));
  await assertSucceeds(updateDoc(doc(owner, 'groups/g1/invites/' + token), {active: false}));
  await assertFails(updateDoc(doc(owner, 'groups/g1/invites/' + token), {active: true}));
});

test('leden wijzigen alleen hun weergavenaam; alleen spelers kunnen vertrekken of worden verwijderd', async () => {
  await seedGroup();
  const owner = as('owner'), alice = as('alice'), bob = as('bob');
  await assertSucceeds(updateDoc(doc(alice, 'groups/g1/members/alice'), {displayName: 'Anna'}));
  await assertFails(updateDoc(doc(alice, 'groups/g1/members/alice'), {role: 'owner'}));
  await assertFails(updateDoc(doc(alice, 'groups/g1/members/alice'), {displayName: ''}));
  await assertFails(updateDoc(doc(bob, 'groups/g1/members/alice'), {displayName: 'Bram was hier'}));
  await assertFails(deleteDoc(doc(bob, 'groups/g1/members/alice')), 'een speler verwijdert geen andere speler');
  await assertFails(deleteDoc(doc(alice, 'groups/g1/members/owner')), 'de eigenaar blijft');
  await assertFails(deleteDoc(doc(owner, 'groups/g1/members/owner')), 'de eigenaar kan zichzelf niet verwijderen');
  await assertSucceeds(deleteDoc(doc(owner, 'groups/g1/members/alice')));
  await assertFails(getDoc(doc(alice, 'groups/g1')), 'verwijderd lid heeft geen toegang meer');
  await assertSucceeds(deleteDoc(doc(bob, 'groups/g1/members/bob')));
  await assertFails(getDocs(collection(bob, 'groups/g1/members')));
});

test('een lid schrijft alleen eigen cellen in de lopende week; andere spelers kunnen ze alleen lezen', async () => {
  await seedGroup();
  const alice = as('alice'), bob = as('bob'), outsider = as('outsider');
  const mine = doc(alice, `groups/g1/weeks/${week}/players/alice`);
  await assertSucceeds(setDoc(mine, playerWeek('alice', ['1_1', '1_2'])));
  await assertSucceeds(setDoc(mine, {uid: 'alice', weekId: week, cells: arrayUnion('1_3'), updatedAt: serverTimestamp()}, {merge: true}));
  assert.deepEqual((await getDoc(mine)).data().cells.sort(), ['1_1', '1_2', '1_3']);
  assert.equal((await assertSucceeds(getDoc(doc(bob, `groups/g1/weeks/${week}/players/alice`)))).data().cells.length, 3, 'groepsleden zien elkaars cellen');
  await assertSucceeds(getDocs(collection(bob, `groups/g1/weeks/${week}/players`)));
  await assertFails(setDoc(doc(bob, `groups/g1/weeks/${week}/players/alice`), playerWeek('alice', ['9_9'])), 'niet voor een ander');
  await assertFails(setDoc(doc(bob, `groups/g1/weeks/${week}/players/bob`), playerWeek('alice', ['9_9'])), 'uid moet kloppen');
  await assertFails(deleteDoc(doc(bob, `groups/g1/weeks/${week}/players/alice`)));
  await assertFails(getDoc(doc(outsider, `groups/g1/weeks/${week}/players/alice`)));
  await assertFails(setDoc(doc(outsider, `groups/g1/weeks/${week}/players/outsider`), playerWeek('outsider', ['1_1'])), 'niet-lid');
});

test('cellen kunnen niet worden verwijderd, en niet in een afgelopen of toekomstige week worden geschreven', async () => {
  await seedGroup();
  const alice = as('alice');
  const mine = doc(alice, `groups/g1/weeks/${week}/players/alice`);
  await assertSucceeds(setDoc(mine, playerWeek('alice', ['1_1', '1_2'])));
  await assertFails(setDoc(mine, playerWeek('alice', ['1_1'])), 'een cel verwijderen');
  await assertFails(setDoc(mine, playerWeek('alice', [])), 'alles wissen');
  await assertFails(setDoc(doc(alice, `groups/g1/weeks/${lastWeek}/players/alice`), playerWeek('alice', ['2_2'], lastWeek)), 'vorige week');
  await assertFails(setDoc(doc(alice, `groups/g1/weeks/${nextWeek}/players/alice`), playerWeek('alice', ['2_2'], nextWeek)), 'volgende week');
  await assertFails(setDoc(doc(alice, 'groups/g1/weeks/kapot/players/alice'), playerWeek('alice', [], 'kapot')), 'ongeldige week');
  await assertFails(setDoc(doc(alice, `groups/g1/weeks/${week}/players/alice`), playerWeek('alice', ['1_1', '1_2'], lastWeek)), 'weekId in document moet kloppen');
});

test('een weekdocument heeft een vaste vorm met een maximum aan cellen', async () => {
  await seedGroup();
  const alice = as('alice');
  const mine = doc(alice, `groups/g1/weeks/${week}/players/alice`);
  await assertFails(setDoc(mine, playerWeek('alice', ['1_1'], week, {score: 9999})), 'extra veld');
  await assertFails(setDoc(mine, playerWeek('alice', 'geen lijst')), 'cells moet een lijst zijn');
  await assertFails(setDoc(mine, playerWeek('alice', ['1_1'], week, {updatedAt: Timestamp.fromMillis(1)})), 'valse tijd');
  await assertFails(setDoc(mine, playerWeek('alice', Array.from({length: 2501}, (_, i) => i + '_1'))), 'te veel cellen');
  const many = Array.from({length: 2000}, (_, i) => i + '_7');
  await assertSucceeds(setDoc(mine, playerWeek('alice', many)));
  await assertSucceeds(setDoc(mine, {uid: 'alice', weekId: week, cells: arrayUnion('9_9'), updatedAt: serverTimestamp()}, {merge: true}));
});

test('spelers kunnen hun eigen gegevens altijd verwijderen, ook na het verlaten van de groep', async () => {
  await seedGroup();
  const alice = as('alice');
  await assertSucceeds(setDoc(doc(alice, `groups/g1/weeks/${week}/players/alice`), playerWeek('alice', ['1_1'])));
  await assertSucceeds(deleteDoc(doc(alice, 'groups/g1/members/alice')));
  await assertSucceeds(deleteDoc(doc(alice, `groups/g1/weeks/${week}/players/alice`)));
  await assertFails(getDoc(doc(alice, `groups/g1/weeks/${week}/players/alice`)));
});

test('weekuitslagen worden één keer na afloop van de week bewaard en daarna nooit gewijzigd', async () => {
  await seedGroup({firstWeek: addWeeks(week, -3)});
  const alice = as('alice'), outsider = as('outsider');
  const result = (weekId, extra = {}) => ({
    weekId, mode: 'territory', winners: ['alice'], totalCells: 4,
    standings: [{uid: 'alice', name: 'alice', cells: 4, area: 40000, rank: 1}],
    closedBy: 'alice', closedAt: serverTimestamp(), ...extra,
  });
  await assertSucceeds(setDoc(doc(alice, `groups/g1/results/${lastWeek}`), result(lastWeek)));
  await assertFails(setDoc(doc(alice, `groups/g1/results/${lastWeek}`), result(lastWeek, {winners: ['bob']})), 'overschrijven');
  await assertFails(updateDoc(doc(alice, `groups/g1/results/${lastWeek}`), {winners: ['bob']}));
  await assertFails(deleteDoc(doc(as('owner'), `groups/g1/results/${lastWeek}`)));
  await assertFails(setDoc(doc(alice, `groups/g1/results/${week}`), result(week)), 'lopende week is nog niet afgesloten');
  await assertFails(setDoc(doc(alice, `groups/g1/results/${nextWeek}`), result(nextWeek)), 'toekomstige week');
  await assertFails(setDoc(doc(alice, `groups/g1/results/${addWeeks(week, -8)}`), result(addWeeks(week, -8))), 'voor de start van de groep');
  await assertFails(setDoc(doc(alice, `groups/g1/results/${addWeeks(week, -2)}`), result(addWeeks(week, -2), {closedBy: 'bob'})), 'valse afsluiter');
  await assertFails(setDoc(doc(alice, `groups/g1/results/${addWeeks(week, -2)}`), result(addWeeks(week, -2), {extra: 1})), 'extra veld');
  await assertFails(setDoc(doc(outsider, `groups/g1/results/${addWeeks(week, -2)}`), result(addWeeks(week, -2), {closedBy: 'outsider'})), 'niet-lid');
  assert.equal((await assertSucceeds(getDoc(doc(as('bob'), `groups/g1/results/${lastWeek}`)))).data().winners[0], 'alice');
  await assertFails(getDoc(doc(outsider, `groups/g1/results/${lastWeek}`)));
});

test('het privé overzicht van groepen is alleen voor de eigenaar zichtbaar en de rest blijft geweigerd', async () => {
  const alice = as('alice'), bob = as('bob');
  await assertSucceeds(setDoc(doc(alice, 'users/alice/playGroups/g1'), {groupId: 'g1', name: 'Vrienden'}));
  await assertSucceeds(getDocs(collection(alice, 'users/alice/playGroups')));
  await assertFails(getDoc(doc(bob, 'users/alice/playGroups/g1')));
  await assertFails(setDoc(doc(bob, 'users/alice/playGroups/g2'), {groupId: 'g2'}));
  await assertFails(getDoc(doc(alice, 'groups/g1/onbekend/x')));
  await assertFails(setDoc(doc(alice, 'playing/x'), {a: 1}));
});
