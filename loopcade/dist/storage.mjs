import {read, write} from './ui.mjs';
import {firebaseConfig, firebaseIsConfigured, emulatorConfig, FIREBASE_SDK_VERSION} from './firebase-config.mjs';
import {encodePath, decodePath} from './route-codec.mjs';
import {preferences as sceneryPreferences} from './scenery.mjs';

const SCHEMA_VERSION = 1;
const DEFAULT_PREFERENCES = Object.freeze({preferredMode: 'run', preferredDistance: 5000});
const configured = firebaseIsConfigured();
const listeners = new Set();
const activityWrites = new Map();
let auth, db, sdk = {}, initialization, migrationPromise, authGeneration = 0;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const cleanText = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const sceneryKeys = new Set(sceneryPreferences.map(preference => preference.key));

function normalizeActivity(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id || raw.id.length > 128
    || !['run', 'walk'].includes(raw.mode) || !Number.isFinite(raw.end)
    || !Number.isFinite(raw.meters) || raw.meters <= 0) return null;
  const path = Array.isArray(raw.path) ? raw.path.filter(point => Array.isArray(point)
    && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])) : [];
  return {
    id: raw.id,
    began: finite(raw.began, raw.end),
    end: raw.end,
    elapsed: Math.max(0, finite(raw.elapsed)),
    mode: raw.mode,
    place: cleanText(raw.place, 160) || 'Gent',
    from: ['string', 'number'].includes(typeof raw.from) ? raw.from : '',
    meters: raw.meters,
    height: Number.isFinite(raw.height) ? raw.height : null,
    points: Math.max(0, finite(raw.points)),
    target: Math.max(0, finite(raw.target, raw.meters)),
    note: cleanText(raw.note, 500),
    voice: Boolean(raw.voice),
    requested: Array.isArray(raw.requested) ? [...new Set(raw.requested.filter(key => sceneryKeys.has(key)))] : [],
    matches: Array.isArray(raw.matches) ? raw.matches.filter(match => sceneryKeys.has(match?.key)).slice(0, sceneryKeys.size).map(match => ({
      key: match.key,
      met: Boolean(match.met),
      meters: Math.max(0, finite(match.meters)),
      ...(match.key === 'architecture' ? {names: Array.isArray(match.names) ? match.names.slice(0, 20).map(name => cleanText(name, 160)) : []} : {}),
    })) : [],
    path,
  };
}

export function readLocalActivities() {
  const items = read('activities', []);
  return Array.isArray(items) ? items.map(normalizeActivity).filter(Boolean) : [];
}

function initialState() {
  return {
    configured,
    status: configured ? 'loading' : 'unconfigured',
    user: null,
    activities: configured ? [] : readLocalActivities(),
    preferences: configured ? {...DEFAULT_PREFERENCES} : read('preferences', {...DEFAULT_PREFERENCES}),
    error: configured ? '' : 'Firebase is nog niet geconfigureerd. Activiteiten blijven alleen in deze browser staan.',
    migration: null,
  };
}

let state = initialState();
export const getStorageState = () => state;
export const storageIdentity = () => state.user?.uid || (!state.configured ? 'local' : null);
export const canSaveActivities = () => state.status === 'unconfigured'
  || (state.status === 'ready' && Boolean(state.user));

function notify() {
  for (const listener of listeners) {
    try { listener(state); } catch (error) { console.error('Loopcade opslaglistener:', error); }
  }
}

export function subscribeStorage(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

function setState(patch) {
  state = {...state, ...patch};
  notify();
}

function userSummary(user) {
  return user ? {
    uid: user.uid,
    displayName: user.displayName || '',
    email: user.email || '',
    isAnonymous: user.isAnonymous,
  } : null;
}

function cleanPreferences(preferences) {
  const next = {...DEFAULT_PREFERENCES};
  if (['run', 'walk'].includes(preferences?.preferredMode)) next.preferredMode = preferences.preferredMode;
  if (Number.isFinite(preferences?.preferredDistance)
    && preferences.preferredDistance >= 1000 && preferences.preferredDistance <= 12000) {
    next.preferredDistance = preferences.preferredDistance;
  }
  return next;
}

function activityFields(item) {
  const {path, ...fields} = item;
  return {...fields, schemaVersion: SCHEMA_VERSION, hasRoute: path.length > 0};
}

async function ensureUserDocument(user) {
  const reference = sdk.doc(db, 'users', user.uid);
  const snapshot = await sdk.getDoc(reference);
  const profile = {
    displayName: user.displayName || '',
    email: user.email || '',
    isAnonymous: user.isAnonymous,
  };
  const data = {
    schemaVersion: SCHEMA_VERSION,
    profile,
    updatedAt: sdk.serverTimestamp(),
    lastLoginAt: sdk.serverTimestamp(),
  };
  if (!snapshot.exists()) {
    data.createdAt = sdk.serverTimestamp();
    data.preferences = {...DEFAULT_PREFERENCES};
  }
  await sdk.setDoc(reference, data, {merge: true});
  return cleanPreferences(snapshot.exists() ? snapshot.data().preferences : DEFAULT_PREFERENCES);
}

async function loadCloudActivities(uid) {
  const snapshots = await sdk.getDocs(sdk.collection(db, 'users', uid, 'activities'));
  const items = await Promise.all(snapshots.docs.map(async document => {
    const route = await sdk.getDoc(sdk.doc(db, 'users', uid, 'routes', document.id));
    const path = route.exists() ? decodePath(route.data().path) : [];
    return normalizeActivity({...document.data(), id: document.id, path});
  }));
  return items.filter(Boolean).sort((a, b) => b.end - a.end);
}

function timeoutAfter(promise, milliseconds = 15000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Firebase reageert niet. Controleer je verbinding en probeer opnieuw.')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function applyAuthUser(user) {
  const generation = ++authGeneration;
  setState({
    status: user ? 'loading' : 'ready',
    user: userSummary(user),
    activities: [],
    preferences: {...DEFAULT_PREFERENCES},
    migration: null,
    error: '',
  });
  if (!user) return;
  try {
    const preferences = await timeoutAfter(ensureUserDocument(user));
    const activities = await timeoutAfter(loadCloudActivities(user.uid));
    if (generation !== authGeneration) return;
    setState({status: 'ready', user: userSummary(user), activities, preferences, error: ''});
  } catch (error) {
    if (generation !== authGeneration) return;
    console.error('Loopcade Firestore laden:', error);
    setState({
      status: 'error',
      user: userSummary(user),
      activities: [],
      error: 'Je account is actief, maar je gegevens konden niet worden geladen. Controleer Firestore, de regels en je verbinding.',
    });
  }
}

export function initializeStorage() {
  if (initialization) return initialization;
  if (!configured) {
    initialization = Promise.resolve();
    return initialization;
  }
  initialization = (async () => {
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-firestore.js`),
      ]);
      sdk = {...authModule, ...firestoreModule};
      const app = appModule.initializeApp(firebaseConfig);
      auth = authModule.getAuth(app);
      db = firestoreModule.getFirestore(app);
      if (emulatorConfig.enabled) {
        authModule.connectAuthEmulator(auth, emulatorConfig.authUrl, {disableBanner: true});
        firestoreModule.connectFirestoreEmulator(db, emulatorConfig.firestoreHost, emulatorConfig.firestorePort);
      }
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      await new Promise(resolve => {
        let first = true;
        authModule.onAuthStateChanged(auth, async user => {
          await applyAuthUser(user);
          if (first) { first = false; resolve(); }
        }, error => {
          console.error('Loopcade authenticatie:', error);
          setState({status: 'error', user: null, activities: [], error: 'Authenticatie kon niet worden gestart. Vernieuw de pagina of probeer later opnieuw.'});
          if (first) { first = false; resolve(); }
        });
      });
    } catch (error) {
      console.error('Loopcade Firebase initialisatie:', error);
      setState({status: 'error', user: null, activities: [], error: 'Firebase kon niet worden geladen. De routeplanner werkt, maar account en cloudopslag zijn nu niet beschikbaar.'});
    }
  })();
  return initialization;
}

async function requireAuth() {
  if (!configured) return null;
  await initializeStorage();
  if (!auth?.currentUser) throw new Error('Log in of ga als gast verder om je rondje te bewaren.');
  return auth.currentUser;
}

export async function signInWithGoogle({linkGuest = true} = {}) {
  await requireAuthConfiguration();
  if (auth.currentUser?.isAnonymous && linkGuest) return linkGuestToGoogle();
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  return sdk.signInWithPopup(auth, provider);
}

export async function signInAsGuest() {
  await requireAuthConfiguration();
  return sdk.signInAnonymously(auth);
}

export async function linkGuestToGoogle() {
  await requireAuthConfiguration();
  if (!auth.currentUser?.isAnonymous) throw new Error('Alleen een actief gastaccount kan worden gekoppeld.');
  const provider = new sdk.GoogleAuthProvider();
  provider.setCustomParameters({prompt: 'select_account'});
  const result = await sdk.linkWithPopup(auth.currentUser, provider);
  const preferences = await ensureUserDocument(result.user);
  setState({user: userSummary(result.user), preferences, status: 'ready', error: ''});
  return result;
}

export async function signOutUser() {
  await requireAuthConfiguration();
  setState({status: 'loading', user: null, activities: [], preferences: {...DEFAULT_PREFERENCES}, migration: null, error: ''});
  await sdk.signOut(auth);
}

async function requireAuthConfiguration() {
  if (!configured) throw new Error('Firebase is nog niet geconfigureerd. Vul eerst dist/firebase-config.mjs in.');
  await initializeStorage();
  if (!auth) throw new Error(state.error || 'Firebase authenticatie is niet beschikbaar.');
}

function mergeActivity(item) {
  const activities = [item, ...state.activities.filter(existing => existing.id !== item.id)]
    .sort((a, b) => b.end - a.end);
  setState({activities, error: ''});
}

export async function saveActivity(raw) {
  const item = normalizeActivity(raw);
  if (!item) throw new Error('Deze activiteit bevat ongeldige gegevens en kan niet worden bewaard.');
  if (!configured) {
    const all = readLocalActivities();
    write('activities', [item, ...all.filter(existing => existing.id !== item.id)]);
    mergeActivity(item);
    return item;
  }
  const user = await requireAuth();
  if (state.status !== 'ready') throw new Error('Wacht tot je accountgegevens geladen zijn en probeer opnieuw.');
  const key = `${user.uid}:${item.id}`;
  if (activityWrites.has(key)) return activityWrites.get(key);
  const operation = (async () => {
    const batch = sdk.writeBatch(db);
    batch.set(sdk.doc(db, 'users', user.uid, 'activities', item.id), {
      ...activityFields(item), createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
    });
    if (item.path.length) {
      batch.set(sdk.doc(db, 'users', user.uid, 'routes', item.id), {
        activityId: item.id,
        encoding: 'delta36-v1',
        path: encodePath(item.path),
        pointCount: decodePath(encodePath(item.path)).length,
        originalPointCount: item.path.length,
        updatedAt: sdk.serverTimestamp(),
      });
    }
    await batch.commit();
    if (auth.currentUser?.uid === user.uid) mergeActivity(item);
    return item;
  })();
  activityWrites.set(key, operation);
  try { return await operation; }
  finally { if (activityWrites.get(key) === operation) activityWrites.delete(key); }
}

export async function saveReflection(id, {note, voice}) {
  const cleanNote = cleanText(note, 500);
  if (!configured) {
    const all = readLocalActivities();
    const item = all.find(activity => activity.id === id);
    if (!item) throw new Error('De activiteit is niet meer beschikbaar.');
    item.note = cleanNote;
    item.voice = Boolean(voice);
    write('activities', all);
    mergeActivity(item);
    return;
  }
  const user = await requireAuth();
  await sdk.updateDoc(sdk.doc(db, 'users', user.uid, 'activities', id), {
    note: cleanNote,
    voice: Boolean(voice),
    updatedAt: sdk.serverTimestamp(),
  });
  if (auth.currentUser?.uid === user.uid) {
    const item = state.activities.find(activity => activity.id === id);
    if (item) mergeActivity({...item, note: cleanNote, voice: Boolean(voice)});
  }
}

export async function savePreferences(preferences) {
  const next = cleanPreferences({...state.preferences, ...preferences});
  if (!configured) {
    write('preferences', next);
    setState({preferences: next});
    return;
  }
  const user = await requireAuth();
  await sdk.setDoc(sdk.doc(db, 'users', user.uid), {
    preferences: next,
    updatedAt: sdk.serverTimestamp(),
  }, {merge: true});
  if (auth.currentUser?.uid === user.uid) setState({preferences: next});
}

export async function migrateLocalActivities() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const user = await requireAuth();
    if (state.status !== 'ready') throw new Error('Wacht tot je accountgegevens geladen zijn.');
    const local = readLocalActivities();
    const known = new Set(state.activities.map(item => item.id));
    const pending = local.filter(item => !known.has(item.id));
    const result = {total: local.length, imported: pending.length, skipped: local.length - pending.length, importedIds: []};

    // Twee documenten per activiteit; blijf ruim onder de limiet van 500 writes per batch.
    for (let offset = 0; offset < pending.length; offset += 200) {
      const chunk = pending.slice(offset, offset + 200);
      const batch = sdk.writeBatch(db);
      for (const item of chunk) {
        batch.set(sdk.doc(db, 'users', user.uid, 'activities', item.id), {
          ...activityFields(item), createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(),
        });
        if (item.path.length) {
          const path = encodePath(item.path);
          batch.set(sdk.doc(db, 'users', user.uid, 'routes', item.id), {
            activityId: item.id, encoding: 'delta36-v1', path,
            pointCount: decodePath(path).length, originalPointCount: item.path.length,
            updatedAt: sdk.serverTimestamp(),
          });
        }
      }
      await batch.commit();
      result.importedIds.push(...chunk.map(item => item.id));
      if (auth.currentUser?.uid === user.uid) {
        setState({activities: [...chunk, ...state.activities].sort((a, b) => b.end - a.end)});
      }
    }
    if (auth.currentUser?.uid === user.uid) setState({migration: {...result, completedAt: Date.now()}});
    return result;
  })();
  try { return await migrationPromise; }
  finally { migrationPromise = null; }
}
