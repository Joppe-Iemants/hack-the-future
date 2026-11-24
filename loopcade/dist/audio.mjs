import {getStorageState} from './storage.mjs';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('loopcade-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('clips');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clipOperation(key, blob, {onlyIfMissing = false} = {}) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const writing = blob !== undefined;
      const transaction = db.transaction('clips', writing ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('clips');
      let request;
      if (writing && onlyIfMissing) {
        const existing = store.getKey(key);
        existing.onsuccess = () => {
          if (existing.result !== undefined) return;
          store.put(blob, key);
        };
        request = existing;
      } else {
        request = writing ? store.put(blob, key) : store.get(key);
      }
      transaction.oncomplete = () => resolve(writing && !onlyIfMissing ? request.result : request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Cloudgebruikers krijgen een eigen namespace. Oude lokale opnames behouden hun sleutel
// totdat de gebruiker expliciet migreert, zodat accounts elkaars audio nooit zien.
function audioKey(id) {
  const state = getStorageState();
  return state.configured ? `${state.user?.uid || 'signed-out'}:${id}` : id;
}

export const readAudio = id => clipOperation(audioKey(id));
export const writeAudio = (id, blob) => clipOperation(audioKey(id), blob);

export async function migrateAudioOwnership(ids, uid) {
  let copied = 0;
  for (const id of ids) {
    const blob = await clipOperation(id);
    if (!blob) continue;
    const existing = await clipOperation(`${uid}:${id}`);
    if (existing) continue;
    await clipOperation(`${uid}:${id}`, blob, {onlyIfMissing: true});
    copied++;
  }
  return copied;
}
