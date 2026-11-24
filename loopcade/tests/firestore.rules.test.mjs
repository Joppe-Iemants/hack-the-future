import test, {before, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, getDocs, collection} from 'firebase/firestore';

let environment;
before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-loopcade',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});
after(async () => { await environment?.cleanup(); });
beforeEach(async () => { await environment?.clearFirestore(); });

test('niet-ingelogde clients hebben geen toegang', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'users/alice')));
  await assertFails(setDoc(doc(db, 'users/alice/activities/run-1'), {meters: 5000}));
  await assertFails(getDocs(collection(db, 'users/alice/activities')));
});

test('een gebruiker kan zijn eigen profiel, activiteit en route schrijven en lezen', async () => {
  const db = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(db, 'users/alice'), {schemaVersion: 1, preferences: {preferredMode: 'run'}}));
  await assertSucceeds(setDoc(doc(db, 'users/alice/activities/run-1'), {id: 'run-1', meters: 5000}));
  await assertSucceeds(setDoc(doc(db, 'users/alice/routes/run-1'), {activityId: 'run-1', path: 'v1.0,0'}));
  assert.equal((await assertSucceeds(getDoc(doc(db, 'users/alice/activities/run-1')))).data().meters, 5000);
});

test('een anonieme gebruiker heeft dezelfde strikt eigen toegang', async () => {
  const db = environment.authenticatedContext('anonymous-guest', {firebase: {sign_in_provider: 'anonymous'}}).firestore();
  await assertSucceeds(setDoc(doc(db, 'users/anonymous-guest/activities/guest-run'), {id: 'guest-run'}));
  await assertSucceeds(getDoc(doc(db, 'users/anonymous-guest/activities/guest-run')));
});

test('andere gebruikers en gasten kunnen elkaars gegevens niet lezen of wijzigen', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice/activities/private'), {note: 'privé'}));
  const bob = environment.authenticatedContext('bob').firestore();
  await assertFails(getDoc(doc(bob, 'users/alice')));
  await assertFails(getDoc(doc(bob, 'users/alice/activities/private')));
  await assertFails(setDoc(doc(bob, 'users/alice/activities/private'), {note: 'overschreven'}));
  await assertFails(setDoc(doc(bob, 'users/alice/routes/private'), {path: 'v1.0,0'}));
  await assertFails(getDocs(collection(bob, 'users/alice/activities')));
});

test('onbekende collecties blijven standaard geweigerd', async () => {
  const db = environment.authenticatedContext('alice').firestore();
  await assertFails(getDoc(doc(db, 'public/alice')));
  await assertFails(setDoc(doc(db, 'users/alice/activities/run-1/extra/document'), {value: true}));
});

test('demovrienden op een gebruikersprofiel blijven privé voor dat account', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), {demoFriends: {'demo-yara': {status: 'accepted'}}}));
  await assertSucceeds(getDoc(doc(alice, 'users/alice')));
  await assertFails(getDoc(doc(bob, 'users/alice')));
  await assertFails(setDoc(doc(bob, 'users/alice'), {demoFriends: {}}, {merge: true}));
});
