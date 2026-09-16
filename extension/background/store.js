/**
 * IndexedDB persistence for in-progress and finished recordings.
 *
 * Everything the recorder learns is written here immediately. MV3 terminates an
 * idle service worker after about thirty seconds and a match has long quiet
 * stretches, so worker memory is not a place a match can live: a re-awakened
 * worker must be able to resume a session it does not remember starting.
 */
const DB = 'riftatlas-replay';
const VERSION = 1;

export const SESSIONS = 'sessions';   // roomCode -> session metadata + origin snapshot
export const COMMITS = 'commits';     // [roomCode, sequence] -> commit
export const EXTRAS = 'extras';       // [roomCode, kind, id] -> chat / gap snapshot / error
export const REPLAYS = 'replays';     // roomCode -> finished .ratlas.json

let opening = null;

export function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'roomCode' });
      if (!db.objectStoreNames.contains(COMMITS)) db.createObjectStore(COMMITS, { keyPath: ['roomCode', 'sequence'] });
      if (!db.objectStoreNames.contains(EXTRAS)) db.createObjectStore(EXTRAS, { keyPath: ['roomCode', 'kind', 'id'] });
      if (!db.objectStoreNames.contains(REPLAYS)) db.createObjectStore(REPLAYS, { keyPath: 'roomCode' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    // `request.result` is undefined for a key that is absent, which is a
    // meaningful answer. Unwrap explicitly rather than with `??`, or a miss
    // resolves to the IDBRequest itself and gets mistaken for a record.
    tx.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : request);
    tx.onerror = () => reject(tx.error);
  }));
}

export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const all = (store, range) => run(store, 'readonly', (s) => s.getAll(range));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

/** Every commit for one room, in sequence order. */
export function commitsFor(roomCode) {
  return all(COMMITS, IDBKeyRange.bound([roomCode, -Infinity], [roomCode, Infinity]))
    .then((rows) => rows.sort((a, b) => a.sequence - b.sequence));
}

/** Extras of one kind for one room. */
export function extrasFor(roomCode, kind) {
  return all(EXTRAS, IDBKeyRange.bound([roomCode, kind, ''], [roomCode, kind, '￿']));
}

/** Delete every trace of one room - used by the popup's delete action. */
export async function dropRoom(roomCode) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS, COMMITS, EXTRAS, REPLAYS], 'readwrite');
    tx.objectStore(SESSIONS).delete(roomCode);
    tx.objectStore(REPLAYS).delete(roomCode);
    tx.objectStore(COMMITS).delete(IDBKeyRange.bound([roomCode, -Infinity], [roomCode, Infinity]));
    tx.objectStore(EXTRAS).delete(IDBKeyRange.bound([roomCode, '', ''], [roomCode, '￿', '￿']));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
