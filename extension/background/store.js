/**
 * IndexedDB persistence for in-progress and finished recordings.
 *
 * Everything the recorder learns is written here immediately. MV3 terminates an
 * idle service worker after about thirty seconds and a match has long quiet
 * stretches, so worker memory is not a place a match can live: a re-awakened
 * worker must be able to resume a session it does not remember starting.
 *
 * ── Recording ids ────────────────────────────────────────────────────────────
 *
 * The key is a **recording id**, not a room code. RiftAtlas room codes are five
 * characters, so they are certainly reused over time, and keying by room code
 * meant a recycled code silently merged two different matches - the new match's
 * sequence 1 overwriting the old one's.
 *
 * A recording id is `<roomCode>@<startedAt>`, which stays unique across reuse
 * and still sorts and reads sensibly. The key path is unchanged, so no
 * migration is needed and nothing already recorded is lost: existing rows keep
 * a bare room code as their id, which `roomOf` handles.
 */
const DB = 'riftatlas-replay';
const VERSION = 1;

export const SESSIONS = 'sessions';   // id -> session metadata + origin snapshot
export const COMMITS = 'commits';     // [id, sequence] -> commit
export const EXTRAS = 'extras';       // [id, kind, key] -> chat / gap snapshot / error
export const REPLAYS = 'replays';     // id -> finished .ratlas.json

/** A recording's identity: the room, plus when this recording began. */
export function recordingId(roomCode, startedAt) {
  return `${roomCode}@${startedAt}`;
}

/** The room code a recording id refers to; also accepts a bare room code. */
export function roomOf(id) {
  return String(id).split('@')[0];
}

let opening = null;

export function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // `roomCode` is the key path for historical reasons; the value stored in
      // it is a recording id. Renaming it would mean a migration that could
      // lose recordings, which is not worth the tidiness.
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

/** Every commit for one recording, in sequence order. */
export function commitsFor(id) {
  return all(COMMITS, IDBKeyRange.bound([id, -Infinity], [id, Infinity]))
    .then((rows) => rows.sort((a, b) => a.sequence - b.sequence));
}

/** Extras of one kind for one recording. */
export function extrasFor(id, kind) {
  return all(EXTRAS, IDBKeyRange.bound([id, kind, ''], [id, kind, '￿']));
}

/**
 * The recording currently being written for a room, if any.
 *
 * A finished recording is never appended to, so a room code coming back later -
 * whether recycled by RiftAtlas or a rematch in a fresh room - starts its own
 * recording rather than being merged into the old one.
 */
export async function activeRecordingFor(roomCode) {
  const sessions = await all(SESSIONS);
  const candidates = sessions
    .filter((s) => roomOf(s.roomCode) === roomCode && s.finished !== true)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return candidates[0] ?? null;
}

/** Delete every trace of one recording. */
export async function dropRecording(id) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS, COMMITS, EXTRAS, REPLAYS], 'readwrite');
    tx.objectStore(SESSIONS).delete(id);
    tx.objectStore(REPLAYS).delete(id);
    tx.objectStore(COMMITS).delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    tx.objectStore(EXTRAS).delete(IDBKeyRange.bound([id, '', ''], [id, '￿', '￿']));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
