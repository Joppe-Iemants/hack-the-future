// Firestore-opslag voor Spelen: groepen, uitnodigingen, wekelijkse cellen en weekuitslagen.
// Het datamodel en de toegangsregels staan beschreven in README.md en firestore.rules.
import {firestoreContext} from './storage.mjs';
import {DEFAULT_MODE, getGameMode} from './play-modes.mjs';
import {buildResult} from './play-scoring.mjs';
import {weekOf, weeksToClose, isWeekId, addWeeks} from './play-time.mjs';

export const INVITE_DAYS = 7;
const SCHEMA_VERSION = 1;
const CODE_PATTERN = /^([A-Za-z0-9]{20})\.([A-Za-z0-9_-]{20,64})$/;

const cleanName = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanDisplayName = value => cleanName(value, 30);

async function context() {
  const ctx = await firestoreContext();
  if (!ctx) throw new Error('Firebase is nog niet geconfigureerd.');
  return ctx;
}

function ensureCurrent(ctx) {
  if (!ctx.isCurrent()) throw new Error('Je bent van account gewisseld. Probeer opnieuw.');
}

const isDenied = error => error?.code === 'permission-denied';

export function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const makeInviteCode = (groupId, token) => groupId + '.' + token;
export function parseInviteCode(text) {
  const raw = String(text ?? '').trim();
  const fromLink = /#play\/join\/([^\s?#]+)/.exec(raw);
  const match = CODE_PATTERN.exec(fromLink ? decodeURIComponent(fromLink[1]) : raw);
  return match ? {groupId: match[1], token: match[2]} : null;
}

function groupFrom(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: cleanName(data.name, 40) || 'Groep',
    mode: getGameMode(data.mode) ? data.mode : DEFAULT_MODE,
    ownerUid: data.ownerUid,
    start: {name: cleanName(data.start?.name, 80), lon: data.start?.lon, lat: data.start?.lat},
    firstWeek: isWeekId(data.firstWeek) ? data.firstWeek : weekOf(Date.now()).id,
  };
}

const memberFrom = snapshot => {
  const data = snapshot.data();
  return {uid: snapshot.id, displayName: cleanName(data.displayName, 30) || 'Speler', role: data.role === 'owner' ? 'owner' : 'player'};
};

// ----- groepen --------------------------------------------------------------

// Groepen waarvan ik lid ben. Een verouderde verwijzing (bijv. na verwijdering door de eigenaar) wordt opgeruimd.
export async function listMyGroups() {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const index = await sdk.getDocs(sdk.collection(db, 'users', user.uid, 'playGroups'));
  const groups = [];
  await Promise.all(index.docs.map(async entry => {
    try {
      const snapshot = await sdk.getDoc(sdk.doc(db, 'groups', entry.id));
      if (snapshot.exists()) { groups.push(groupFrom(snapshot)); return; }
    } catch (error) {
      if (!isDenied(error)) throw error;
    }
    await sdk.deleteDoc(entry.ref).catch(() => {});
  }));
  ensureCurrent(ctx);
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

export async function createGroup({name, start, displayName}) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const groupName = cleanName(name, 40), ownerName = cleanDisplayName(displayName);
  if (!groupName) throw new Error('Geef je groep een naam.');
  if (!ownerName) throw new Error('Kies een naam waaronder je vrienden je zien.');
  if (!start || !Number.isFinite(start.lon) || !Number.isFinite(start.lat)) throw new Error('Kies een gezamenlijk startpunt.');
  const reference = sdk.doc(sdk.collection(db, 'groups'));
  const firstWeek = weekOf(Date.now()).id;
  const batch = sdk.writeBatch(db);
  batch.set(reference, {
    schemaVersion: SCHEMA_VERSION, name: groupName, mode: DEFAULT_MODE, ownerUid: user.uid,
    start: {name: cleanName(start.name, 80) || 'Startpunt', lon: start.lon, lat: start.lat},
    firstWeek, createdAt: sdk.serverTimestamp(),
  });
  batch.set(sdk.doc(db, 'groups', reference.id, 'members', user.uid), {
    uid: user.uid, displayName: ownerName, role: 'owner', joinedAt: sdk.serverTimestamp(),
  });
  batch.set(sdk.doc(db, 'users', user.uid, 'playGroups', reference.id), {
    groupId: reference.id, name: groupName, role: 'owner', joinedAt: sdk.serverTimestamp(),
  });
  await batch.commit();
  ensureCurrent(ctx);
  return groupFrom(await sdk.getDoc(reference));
}

// ----- uitnodigen en deelnemen ------------------------------------------------

export async function createInvite(group, ownerName) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const token = randomToken();
  const expiresAt = Date.now() + INVITE_DAYS * 86400000;
  await sdk.setDoc(sdk.doc(db, 'groups', group.id, 'invites', token), {
    createdBy: user.uid, createdAt: sdk.serverTimestamp(), expiresAt: sdk.Timestamp.fromMillis(expiresAt), active: true,
    groupName: group.name, startName: group.start.name || 'Startpunt', ownerName: cleanDisplayName(ownerName) || 'Eigenaar',
  });
  ensureCurrent(ctx);
  return {token, code: makeInviteCode(group.id, token), expiresAt};
}

export async function listInvites(groupId) {
  const ctx = await context();
  const {db, sdk} = ctx;
  const snapshots = await sdk.getDocs(sdk.collection(db, 'groups', groupId, 'invites'));
  const now = Date.now();
  return snapshots.docs.map(snapshot => {
    const data = snapshot.data();
    return {token: snapshot.id, code: makeInviteCode(groupId, snapshot.id), active: data.active === true, expiresAt: data.expiresAt?.toMillis?.() ?? 0};
  }).filter(invite => invite.active && invite.expiresAt > now).sort((a, b) => b.expiresAt - a.expiresAt);
}

export async function revokeInvites(groupId, tokens) {
  const ctx = await context();
  const {db, sdk} = ctx;
  await Promise.all(tokens.map(token => sdk.updateDoc(sdk.doc(db, 'groups', groupId, 'invites', token), {active: false})));
}

// Toont wat er achter een uitnodiging zit, zonder iets te wijzigen.
export async function previewInvite(code) {
  const parsed = parseInviteCode(code);
  if (!parsed) throw new Error('Deze uitnodigingscode klopt niet. Controleer de code of vraag een nieuwe link.');
  const ctx = await context();
  const {db, sdk} = ctx;
  let snapshot;
  try { snapshot = await sdk.getDoc(sdk.doc(db, 'groups', parsed.groupId, 'invites', parsed.token)); }
  catch (error) { if (isDenied(error)) snapshot = null; else throw error; }
  if (!snapshot?.exists()) throw new Error('Deze uitnodiging bestaat niet (meer). Vraag een nieuwe link aan de eigenaar van de groep.');
  const data = snapshot.data();
  const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
  if (data.active !== true) throw new Error('Deze uitnodiging is ingetrokken. Vraag een nieuwe link aan de eigenaar.');
  if (expiresAt <= Date.now()) throw new Error('Deze uitnodiging is verlopen. Vraag een nieuwe link aan de eigenaar.');
  return {...parsed, groupName: cleanName(data.groupName, 40), startName: cleanName(data.startName, 80), ownerName: cleanName(data.ownerName, 30), expiresAt};
}

export async function joinGroup({groupId, token}, displayName) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const name = cleanDisplayName(displayName);
  if (!name) throw new Error('Kies een naam waaronder je vrienden je zien.');
  const reference = sdk.doc(db, 'groups', groupId);
  let existing = null;
  try { existing = await sdk.getDoc(reference); } catch (error) { if (!isDenied(error)) throw error; }
  if (!existing?.exists()) {
    const batch = sdk.writeBatch(db);
    batch.set(sdk.doc(db, 'groups', groupId, 'members', user.uid), {
      uid: user.uid, displayName: name, role: 'player', joinedAt: sdk.serverTimestamp(), inviteId: token,
    });
    try { await batch.commit(); }
    catch (error) {
      if (isDenied(error)) throw new Error('Deelnemen is niet gelukt. De uitnodiging is mogelijk verlopen of ingetrokken.');
      throw error;
    }
  }
  const group = groupFrom(existing?.exists() ? existing : await sdk.getDoc(reference));
  await sdk.setDoc(sdk.doc(db, 'users', user.uid, 'playGroups', groupId), {
    groupId, name: group.name, role: group.ownerUid === user.uid ? 'owner' : 'player', joinedAt: sdk.serverTimestamp(),
  });
  ensureCurrent(ctx);
  return group;
}

export async function leaveGroup(group, weekId) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  if (group.ownerUid === user.uid) throw new Error('De eigenaar kan de groep niet verlaten.');
  const batch = sdk.writeBatch(db);
  // Verwijder al je gedeelde cellen van alle weken sinds de start van de groep.
  const first = isWeekId(group.firstWeek) ? group.firstWeek : weekId;
  const weeks = [];
  for (let week = first; week <= weekId && weeks.length < 150; week = addWeeks(week, 1)) weeks.push(week);
  for (const week of weeks) batch.delete(sdk.doc(db, 'groups', group.id, 'weeks', week, 'players', user.uid));
  batch.delete(sdk.doc(db, 'groups', group.id, 'members', user.uid));
  batch.delete(sdk.doc(db, 'users', user.uid, 'playGroups', group.id));
  await batch.commit();
}

export async function removeMember(group, uid) {
  const ctx = await context();
  const {db, sdk} = ctx;
  await sdk.deleteDoc(sdk.doc(db, 'groups', group.id, 'members', uid));
}

export async function renameMember(groupId, displayName) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const name = cleanDisplayName(displayName);
  if (!name) throw new Error('Kies een naam waaronder je vrienden je zien.');
  await sdk.updateDoc(sdk.doc(db, 'groups', groupId, 'members', user.uid), {displayName: name});
}

// ----- cellen en uitslagen -----------------------------------------------------

const normalizePlayer = snapshot => ({uid: snapshot.id, cells: Array.isArray(snapshot.data().cells) ? snapshot.data().cells.filter(cell => typeof cell === 'string') : []});

async function loadPlayers(ctx, groupId, weekId) {
  const {db, sdk} = ctx;
  return (await sdk.getDocs(sdk.collection(db, 'groups', groupId, 'weeks', weekId, 'players'))).docs.map(normalizePlayer);
}

function resultFrom(snapshot) {
  const data = snapshot.data();
  return {
    weekId: snapshot.id, mode: data.mode, winners: Array.isArray(data.winners) ? data.winners : [], totalCells: data.totalCells ?? 0,
    standings: Array.isArray(data.standings) ? data.standings.map(row => ({
      uid: String(row.uid), name: cleanName(row.name, 30), cells: Number(row.cells) || 0, area: Number(row.area) || 0, rank: Number(row.rank) || 0,
    })) : [],
  };
}

export async function loadGroupState(group, weekId) {
  const ctx = await context();
  const {db, sdk} = ctx;
  const [members, players, results] = await Promise.all([
    sdk.getDocs(sdk.collection(db, 'groups', group.id, 'members')),
    loadPlayers(ctx, group.id, weekId),
    sdk.getDocs(sdk.collection(db, 'groups', group.id, 'results')),
  ]);
  ensureCurrent(ctx);
  return {
    // Eigenaar eerst, daarna op naam.
    members: members.docs.map(memberFrom).sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || a.displayName.localeCompare(b.displayName, 'nl')),
    players,
    results: results.docs.map(resultFrom).sort((a, b) => b.weekId.localeCompare(a.weekId)),
  };
}

// Voegt cellen toe aan het weekdocument van de huidige speler. Bestaande cellen blijven staan.
export async function saveCells(groupId, weekId, cellIds) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const unique = [...new Set(cellIds)];
  for (let offset = 0; offset < unique.length; offset += 400) {
    await sdk.setDoc(sdk.doc(db, 'groups', groupId, 'weeks', weekId, 'players', user.uid), {
      uid: user.uid, weekId, cells: sdk.arrayUnion(...unique.slice(offset, offset + 400)), updatedAt: sdk.serverTimestamp(),
    }, {merge: true});
  }
}

// Sluit voltooide weken af: bewaart de winnaar en de eindstand één keer per week. Een andere speler
// kan dit tegelijk doen; dan bestaat de uitslag al en wordt de bestaande uitslag gebruikt.
export async function closeFinishedWeeks(group, members, knownResults, now = Date.now()) {
  const ctx = await context();
  const {db, sdk, user} = ctx;
  const mode = getGameMode(group.mode);
  const current = weekOf(now).id;
  const closed = knownResults.map(result => result.weekId);
  const created = [];
  for (const weekId of weeksToClose(group.firstWeek, current, closed)) {
    const reference = sdk.doc(db, 'groups', group.id, 'results', weekId);
    const players = await loadPlayers(ctx, group.id, weekId);
    const scored = mode.score({players, members, group});
    const result = buildResult({weekId, mode: group.mode, scored});
    try {
      await sdk.setDoc(reference, {...result, closedBy: user.uid, closedAt: sdk.serverTimestamp()});
      created.push(result);
    } catch (error) {
      if (!isDenied(error)) throw error;
      // Al afgesloten door iemand anders, of de weekgrens is hier nog niet bereikt.
      try {
        const existing = await sdk.getDoc(reference);
        if (existing.exists()) created.push(resultFrom(existing));
      } catch (readError) { if (!isDenied(readError)) throw readError; }
    }
  }
  ensureCurrent(ctx);
  return created;
}
