/**
 * Turns observed frames into persisted recording state.
 *
 * Every frame is redacted and written to IndexedDB as it arrives. Nothing
 * accumulates in worker memory, so an MV3 worker termination mid-match costs
 * nothing.
 */
import { SESSIONS, COMMITS, EXTRAS, put, get } from './store.js';

/** Frame types that carry authoritative state or match context. */
const KEEP = new Set([
  'authoritative_snapshot', 'authoritative_patch_commit',
  'room_shell_sync', 'chat_sync', 'chat_append', 'error',
]);

/** Keys scrubbed before anything is written. Mirrors tools/har_to_jsonl.py. */
const SECRETS = new Set(['authToken', 'token', 'jwt', '_pk']);

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRETS.has(k) && typeof v === 'string' ? '<redacted>' : redact(v);
    }
    return out;
  }
  return value;
}

/**
 * Frames arrive faster than a read-modify-write of the session record can
 * complete, and several types mutate it. Serialise them: without this, a
 * `room_shell_sync` write is silently clobbered by a snapshot write that read
 * the session before it landed, and the replay loses its decklist and format.
 */
let queue = Promise.resolve();

export function onFrame(frame) {
  const next = queue.then(() => handleFrame(frame), () => handleFrame(frame));
  queue = next.catch(() => {});
  return next;
}

async function handleFrame({ data, at }) {
  let msg;
  try { msg = JSON.parse(data); } catch { return null; }
  if (!KEEP.has(msg.type)) return null;

  const roomCode = msg.gameInstanceId;
  if (!roomCode) return null;
  msg = redact(msg);

  let session = await get(SESSIONS, roomCode);
  if (!session) {
    session = {
      roomCode, startedAt: at, lastAt: at,
      origin: null, shell: null, viewer: null,
      // A recorder attached mid-match has no sequence-0 snapshot and cannot
      // anchor; the replay is marked partial rather than looking complete.
      partial: true,
      finished: false,
    };
  }
  session.lastAt = at;

  switch (msg.type) {
    case 'authoritative_snapshot':
      if (!session.origin) {
        session.origin = {
          sequence: msg.sequence,
          snapshot: msg.snapshot,
          gameplayLog: msg.gameplayLog ?? [],
          actionClock: msg.actionClock ?? null,
        };
        session.partial = msg.sequence !== 0;
      } else if (msg.sequence !== session.origin.sequence) {
        // A later snapshot is only kept when it may be needed to repair a gap.
        await put(EXTRAS, {
          roomCode, kind: 'snapshot', id: String(msg.sequence),
          sequence: msg.sequence, snapshot: msg.snapshot,
          gameplayLog: msg.gameplayLog ?? [],
        });
      }
      break;

    case 'authoritative_patch_commit':
      await put(COMMITS, {
        roomCode, sequence: msg.sequence,
        t: at - session.startedAt,
        baseSequence: msg.baseSequence,
        action: msg.action,
        operations: msg.patch.operations,
        actionClock: msg.actionClock ?? null,
      });
      break;

    case 'room_shell_sync':
      if (!session.shell) session.shell = msg.sessionDoc;
      session.viewer = msg.sessionDoc?.viewer ?? session.viewer;
      break;

    case 'chat_sync':
    case 'chat_append':
      for (const entry of msg.chatEntries ?? msg.entries ?? []) {
        await put(EXTRAS, { roomCode, kind: 'chat', id: entry.id, entry });
      }
      break;

    case 'error':
      await put(EXTRAS, {
        roomCode, kind: 'error', id: String(msg.authoritativeSequence ?? at),
        sequence: msg.authoritativeSequence ?? null, code: msg.code ?? null,
      });
      break;
  }

  await put(SESSIONS, session);
  return roomCode;
}

/**
 * Has the match ended? The reference capture ended by concession, narrated in
 * the gameplay log. A normal victory is unverified (open question 5), so socket
 * close remains the backstop trigger.
 */
export function looksFinished(msg) {
  if (msg.type !== 'authoritative_patch_commit') return false;
  const inserted = (msg.patch?.operations ?? [])
    .filter((op) => op.op === 'log_insert')
    .flatMap((op) => op.entries ?? []);
  return inserted.some((e) => / wins\b/.test(e.text ?? '') || /conceded/.test(e.text ?? ''));
}
