import test from 'node:test';
import assert from 'node:assert/strict';
import {createTracker, giveConsent, hasConsent, revokeConsent, readPending, addPending, flushPending} from '../dist/play-tracker.mjs';
import {TerritorySession} from '../dist/play-rules.mjs';
import {cellCenter, cellOf, LON_STEP, LAT_STEP} from '../dist/play-grid.mjs';

const group = {id: 'g1', start: cellCenter(cellOf({lon: 3.7219, lat: 51.05442}))};
const M_LON = LON_STEP / 100, M_LAT = LAT_STEP / 100;
const T0 = Date.UTC(2026, 10, 24, 10, 0, 0);

function memoryStorage() {
  const data = new Map();
  return {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), dump: () => [...data.values()].join('\n')};
}

function fakeGeolocation() {
  const geo = {watching: false, cleared: 0, options: null};
  geo.watchPosition = (onPosition, onError, options) => { geo.watching = true; geo.onPosition = onPosition; geo.onError = onError; geo.options = options; return 7; };
  geo.clearWatch = id => { assert.equal(id, 7); geo.watching = false; geo.cleared++; };
  geo.walk = (east, seconds, accuracy = 8) => geo.onPosition({
    timestamp: T0 + seconds * 1000,
    coords: {longitude: group.start.lon + east * M_LON, latitude: group.start.lat, accuracy},
  });
  return geo;
}

function setup({save, consent = true} = {}) {
  const storage = memoryStorage(), geolocation = fakeGeolocation(), saved = [], timers = [];
  if (consent) giveConsent('u1', storage);
  const tracker = createTracker({
    geolocation, storage, wakeLock: undefined,
    save: save ?? (async (groupId, weekId, ids) => { saved.push({groupId, weekId, ids: [...ids]}); }),
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {},
  });
  const start = () => tracker.start({uid: 'u1', group, createSession: g => new TerritorySession(g)});
  return {storage, geolocation, saved, timers, tracker, start};
}

test('zonder toestemming start de GPS-registratie niet en wordt de locatie niet opgevraagd', () => {
  const {tracker, geolocation, start} = setup({consent: false});
  assert.equal(start(), false);
  assert.equal(geolocation.watching, false);
  assert.equal(tracker.getState().status, 'error');
  assert.match(tracker.getState().message, /toestemming/);
});

test('toestemming geldt per account en kan worden ingetrokken, inclusief de wachtrij', () => {
  const storage = memoryStorage();
  assert.equal(hasConsent('u1', storage), false);
  giveConsent('u1', storage);
  assert.equal(hasConsent('u1', storage), true);
  assert.equal(hasConsent('u2', storage), false);
  addPending('u1', 'g1', [{id: '1_1', weekId: '2026-11-23'}], storage);
  assert.deepEqual(readPending('u1', storage), {g1: {'2026-11-23': ['1_1']}});
  revokeConsent('u1', storage);
  assert.equal(hasConsent('u1', storage), false);
  assert.deepEqual(readPending('u1', storage), {});
});

test('start en stop: tijdens het lopen verzamelt de tracker cellen en stop geeft de locatie vrij en bewaart alles', async () => {
  const {tracker, geolocation, saved, start, storage} = setup();
  assert.equal(start(), true);
  assert.equal(tracker.getState().status, 'tracking');
  assert.equal(geolocation.options.enableHighAccuracy, true);
  assert.equal(start(), false, 'niet dubbel starten');
  for (let i = 0; i <= 40; i++) geolocation.walk(i * 7, i * 5);
  const state = tracker.getState();
  assert.ok(state.found >= 2 && state.pending === state.found, 'cellen staan in de wachtrij');
  assert.equal(saved.length, 0, 'nog niet bewaard voor de timer afloopt');
  await tracker.stop();
  assert.equal(geolocation.watching, false);
  assert.equal(geolocation.cleared, 1);
  assert.equal(tracker.getState().status, 'idle');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].groupId, 'g1');
  assert.equal(saved[0].weekId, '2026-11-23');
  assert.equal(saved[0].ids.length, state.found);
  assert.deepEqual(readPending('u1', storage), {});
  assert.equal(tracker.getState().pending, 0);
});

test('het lokaal bewaarde materiaal bevat alleen cel-id’s en toestemming, geen coördinaten of tijden', async () => {
  const {geolocation, start, storage, tracker} = setup({save: async () => { throw new Error('offline'); }});
  start();
  for (let i = 0; i <= 20; i++) geolocation.walk(i * 7, i * 5);
  const stored = storage.dump();
  assert.ok(!stored.includes(String(group.start.lon).slice(0, 7)), 'geen lengtegraad');
  assert.ok(!stored.includes(String(group.start.lat).slice(0, 8)), 'geen breedtegraad');
  assert.ok(!stored.includes(String(T0).slice(0, 8)), 'geen tijdstippen');
  assert.ok(!stored.includes('accuracy'));
  await tracker.stop();
});

test('bij een mislukte opslag blijven de cellen in de wachtrij en wordt de volgende poging gepland', async () => {
  let attempts = 0;
  const {tracker, geolocation, start, timers, storage} = setup({save: async () => { if (++attempts === 1) throw new Error('offline'); }});
  start();
  for (let i = 0; i <= 20; i++) geolocation.walk(i * 7, i * 5);
  const found = tracker.getState().found;
  await tracker.flush();
  assert.match(tracker.getState().sync, /opnieuw/);
  assert.equal(tracker.getState().pending, found);
  assert.ok(timers.length >= 1);
  await tracker.flush();
  assert.equal(tracker.getState().pending, 0);
  assert.deepEqual(readPending('u1', storage), {});
  await tracker.stop();
});

test('cellen van een inmiddels afgesloten week worden weggegooid met een melding', async () => {
  const error = Object.assign(new Error('denied'), {code: 'permission-denied'});
  const {tracker, geolocation, start, storage} = setup({save: async () => { throw error; }});
  start();
  for (let i = 0; i <= 20; i++) geolocation.walk(i * 7, i * 5);
  await tracker.flush();
  assert.match(tracker.getState().sync, /afgesloten/);
  assert.equal(tracker.getState().pending, 0);
  assert.deepEqual(readPending('u1', storage), {});
  await tracker.stop();
});

test('de wachtrij van een eerdere sessie kan later alsnog worden bewaard', async () => {
  const storage = memoryStorage();
  addPending('u1', 'g1', [{id: '5_5', weekId: '2026-11-23'}, {id: '5_6', weekId: '2026-11-23'}], storage);
  addPending('u1', 'g2', [{id: '9_9', weekId: '2026-11-23'}], storage);
  const calls = [];
  const result = await flushPending('u1', async (groupId, weekId, ids) => { calls.push([groupId, weekId, ids.length]); }, {storage, groupId: 'g1'});
  assert.deepEqual(calls, [['g1', '2026-11-23', 2]]);
  assert.equal(result.saved, 2);
  assert.deepEqual(Object.keys(readPending('u1', storage)), ['g2'], 'andere groepen blijven staan');
});

test('een geweigerde locatietoestemming stopt de registratie met een duidelijke melding', async () => {
  const {tracker, geolocation, start} = setup();
  start();
  geolocation.onError({code: 1});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(geolocation.watching, false);
  assert.equal(tracker.getState().status, 'error');
  assert.match(tracker.getState().message, /geweigerd/);
});

test('zonder locatie-ondersteuning start de registratie niet', () => {
  const storage = memoryStorage(); giveConsent('u1', storage);
  const tracker = createTracker({geolocation: null, storage, save: async () => {}});
  assert.equal(tracker.start({uid: 'u1', group, createSession: g => new TerritorySession(g)}), false);
  assert.match(tracker.getState().message, /ondersteunt geen/);
});

test('slechte nauwkeurigheid levert geen cellen en een uitleg', () => {
  const {tracker, geolocation, start} = setup();
  start();
  geolocation.walk(0, 0, 200);
  assert.equal(tracker.getState().found, 0);
  assert.match(tracker.getState().message, /onnauwkeurig/);
});
