// GPS-registratie voor Spelen. Alleen na expliciete toestemming en alleen tussen Start en Stop.
// De tracker verwerkt metingen live tot cellen en bewaart nooit het volledige spoor: alleen cellen
// die nog niet naar Firestore zijn weggeschreven blijven in een lokale wachtrij.
export const CONSENT_VERSION = 1;
const CONSENT_KEY = 'loopcade-play-consent';
const PENDING_KEY = 'loopcade-play-pending';
const FLUSH_DELAY_MS = 15000;

function readJson(storage, key) {
  try { return JSON.parse(storage?.getItem(key)) ?? {}; } catch { return {}; }
}
function writeJson(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* opslag vol of niet beschikbaar */ }
}

// ----- toestemming (per account, op dit toestel) -----------------------------------

export const hasConsent = (uid, storage = globalThis.localStorage) => readJson(storage, CONSENT_KEY)[uid]?.version === CONSENT_VERSION;
export function giveConsent(uid, storage = globalThis.localStorage, now = Date.now()) {
  writeJson(storage, CONSENT_KEY, {...readJson(storage, CONSENT_KEY), [uid]: {version: CONSENT_VERSION, at: now}});
}
// Intrekken wist ook alle nog niet bewaarde cellen van dit account.
export function revokeConsent(uid, storage = globalThis.localStorage) {
  const consent = readJson(storage, CONSENT_KEY); delete consent[uid];
  writeJson(storage, CONSENT_KEY, consent);
  clearPending(uid, storage);
}

// ----- wachtrij met nog niet bewaarde cellen: { uid: { groupId: { weekId: [cel-id] } } } -----

export function readPending(uid, storage = globalThis.localStorage) {
  const mine = readJson(storage, PENDING_KEY)[uid];
  return mine && typeof mine === 'object' ? mine : {};
}
function writePending(uid, value, storage) {
  const all = readJson(storage, PENDING_KEY);
  if (Object.keys(value).length) all[uid] = value; else delete all[uid];
  writeJson(storage, PENDING_KEY, all);
}
export const clearPending = (uid, storage = globalThis.localStorage) => writePending(uid, {}, storage);
export function addPending(uid, groupId, found, storage = globalThis.localStorage) {
  if (!found.length) return;
  const pending = readPending(uid, storage);
  const weeks = pending[groupId] ??= {};
  for (const {id, weekId} of found) {
    const list = weeks[weekId] ??= [];
    if (!list.includes(id)) list.push(id);
  }
  writePending(uid, pending, storage);
}
export function removePending(uid, groupId, weekId, ids, storage = globalThis.localStorage) {
  const pending = readPending(uid, storage), weeks = pending[groupId];
  if (!weeks?.[weekId]) return;
  const done = new Set(ids);
  weeks[weekId] = weeks[weekId].filter(id => !done.has(id));
  if (!weeks[weekId].length) delete weeks[weekId];
  if (!Object.keys(weeks).length) delete pending[groupId];
  writePending(uid, pending, storage);
}

// Bewaart de wachtrij van één account via `save(groupId, weekId, ids)`. Een afgesloten week
// (permission-denied) wordt weggegooid; andere fouten laten de cellen staan voor een volgende poging.
export async function flushPending(uid, save, {storage = globalThis.localStorage, groupId = null} = {}) {
  const result = {saved: 0, dropped: 0, failed: 0, error: null};
  const pending = readPending(uid, storage);
  for (const [group, weeks] of Object.entries(pending)) {
    if (groupId && group !== groupId) continue;
    for (const [weekId, ids] of Object.entries(weeks)) {
      if (!ids.length) continue;
      try {
        await save(group, weekId, ids);
        removePending(uid, group, weekId, ids, storage);
        result.saved += ids.length;
      } catch (error) {
        if (error?.code === 'permission-denied') {
          removePending(uid, group, weekId, ids, storage);
          result.dropped += ids.length;
        } else {
          result.failed += ids.length;
          result.error = error;
        }
      }
    }
  }
  return result;
}

// ----- de tracker zelf --------------------------------------------------------------

const GEO_ERRORS = {
  1: 'Toegang tot je locatie is geweigerd. Sta locatie toe in je browserinstellingen en start opnieuw.',
  2: 'Je positie is tijdelijk niet beschikbaar. We blijven proberen.',
  3: 'De locatie reageert traag. We blijven proberen.',
};

export function createTracker({
  geolocation = globalThis.navigator?.geolocation, save, storage = globalThis.localStorage,
  now = () => Date.now(), wakeLock = globalThis.navigator?.wakeLock,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const listeners = new Set();
  let state = {status: 'idle', message: '', accuracy: null, found: 0, rejected: 0, pending: 0, sync: '', groupId: null};
  let session = null, watchId = null, uid = null, timer = null, lock = null, flushing = null;

  const emit = patch => { state = {...state, ...patch}; for (const listener of listeners) listener(state); };
  const pendingCount = () => Object.values(readPending(uid, storage)).reduce((sum, weeks) => sum + Object.values(weeks).reduce((n, ids) => n + ids.length, 0), 0);

  async function acquireLock() {
    try { lock = await wakeLock?.request?.('screen'); } catch { lock = null; }
  }
  const onVisible = () => { if (watchId !== null && globalThis.document?.visibilityState === 'visible') acquireLock(); };

  // Bewaart de wachtrij. Cellen die tijdens het bewaren binnenkomen, worden in dezelfde ronde meegenomen.
  function flush() {
    clearTimer(timer); timer = null;
    if (!uid) return Promise.resolve();
    if (flushing) return flushing;
    const owner = uid;
    flushing = (async () => {
      let saved = 0, dropped = 0, failed = false;
      for (let round = 0; round < 3; round++) {
        const result = await flushPending(owner, save, {storage});
        saved += result.saved; dropped += result.dropped; failed ||= result.failed > 0;
        if (failed || !pendingCount()) break;
      }
      const parts = [];
      if (dropped) parts.push(dropped + ' cellen telden niet meer mee omdat hun week al is afgesloten.');
      if (failed) parts.push('Opslaan lukte nog niet; we proberen het opnieuw.');
      emit({pending: pendingCount(), sync: parts.join(' ') || (saved ? 'Bewaard in je groep.' : state.sync)});
      if (failed && watchId !== null) schedule();
    })().finally(() => { flushing = null; });
    return flushing;
  }
  function schedule() {
    if (timer === null) timer = setTimer(() => { timer = null; flush(); }, FLUSH_DELAY_MS);
  }

  function onPosition(position) {
    if (!session) return;
    const {longitude, latitude, accuracy} = position.coords;
    const time = Number.isFinite(position.timestamp) ? position.timestamp : now();
    const outcome = session.addFix({lon: longitude, lat: latitude, accuracy, time});
    const found = outcome.found;
    if (found.length) {
      const weekChanged = Boolean(state.lastWeek) && found.some(cell => cell.weekId !== state.lastWeek);
      addPending(uid, state.groupId, found, storage);
      emit({found: session.stats.found, accuracy: Math.round(accuracy), rejected: session.stats.rejected, pending: pendingCount(), lastWeek: found.at(-1).weekId, message: ''});
      // Bij een weekwissel direct bewaren, anders na een korte vertraging.
      if (weekChanged) flush(); else schedule();
    } else {
      emit({
        accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, rejected: session.stats.rejected,
        message: outcome.accepted ? '' : outcome.reason === 'accuracy' ? 'GPS is nog te onnauwkeurig; even geduld.' : outcome.reason === 'speed' ? 'Een te snelle meting is genegeerd.' : '',
      });
    }
  }

  function onError(error) {
    const fatal = error?.code === 1;
    emit({message: GEO_ERRORS[error?.code] ?? 'De locatie is niet beschikbaar.', ...(fatal ? {status: 'error'} : {})});
    if (fatal) stop();
  }

  // Stopt de registratie, geeft de locatie-toegang direct vrij en bewaart de laatste cellen.
  async function stop() {
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null; session = null;
    globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
    try { await lock?.release?.(); } catch { /* al vrijgegeven */ }
    lock = null;
    if (state.status !== 'error') emit({status: 'idle'});
    if (uid) await flush();
    emit({status: state.status === 'error' ? 'error' : 'idle'});
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isTracking: () => watchId !== null,
    // Start de registratie. De aanroeper controleert vooraf de toestemming; hier wordt dat nogmaals afgedwongen.
    start({uid: owner, group, createSession}) {
      if (watchId !== null) return false;
      if (!hasConsent(owner, storage)) { emit({status: 'error', message: 'Geef eerst toestemming voor GPS-registratie.'}); return false; }
      if (!geolocation) { emit({status: 'error', message: 'Je browser ondersteunt geen locatiebepaling.'}); return false; }
      uid = owner;
      session = createSession(group);
      watchId = geolocation.watchPosition(onPosition, onError, {enableHighAccuracy: true, maximumAge: 0, timeout: 30000});
      emit({status: 'tracking', message: '', accuracy: null, found: 0, rejected: 0, sync: '', groupId: group.id, lastWeek: null, pending: pendingCount()});
      acquireLock();
      globalThis.document?.addEventListener?.('visibilitychange', onVisible);
      return true;
    },
    stop,
    flush,
  };
}
