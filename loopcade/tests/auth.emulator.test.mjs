import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp, deleteApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, signInAnonymously, signOut} from 'firebase/auth';

let app, auth;
before(() => {
  app = initializeApp({apiKey: 'demo-api-key', projectId: 'demo-loopcade', authDomain: 'demo-loopcade.firebaseapp.com'}, 'auth-emulator-test');
  auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableBanner: true});
});
after(async () => { await deleteApp(app); });

test('Auth-emulator maakt een anonieme gast en kan uitloggen', async () => {
  const credential = await signInAnonymously(auth);
  assert.ok(credential.user.uid.length > 0);
  assert.equal(credential.user.isAnonymous, true);
  assert.ok(await credential.user.getIdToken());
  await signOut(auth);
  assert.equal(auth.currentUser, null);
});

test('twee gastaccounts krijgen verschillende gebruikers-ID’s', async () => {
  const first = (await signInAnonymously(auth)).user.uid;
  await signOut(auth);
  const second = (await signInAnonymously(auth)).user.uid;
  await signOut(auth);
  assert.notEqual(first, second);
});
