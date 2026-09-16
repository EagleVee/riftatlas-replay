/**
 * Service worker: routes observed frames into the recorder and serves the popup.
 *
 * Holds no match state. MV3 will terminate this worker repeatedly during a
 * match; everything it learns is already in IndexedDB by the time the message
 * handler returns, so a restart is invisible.
 */
import { onFrame, looksFinished } from './recorder.js';
import { buildReplay } from './finalise.js';
import { SESSIONS, REPLAYS, all, get, put, dropRoom } from './store.js';

/** Rooms whose socket closed or whose log announced a result, awaiting finalise. */
const pendingFinalise = new Set();

async function finalise(roomCode) {
  try {
    const replay = await buildReplay(roomCode);
    await put(REPLAYS, { roomCode, builtAt: Date.now(), replay });
    const session = await get(SESSIONS, roomCode);
    if (session) { session.finished = true; await put(SESSIONS, session); }
    pendingFinalise.delete(roomCode);
  } catch (err) {
    console.warn('[riftatlas-replay] finalise failed for', roomCode, err.message);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'observer') {
    if (msg.kind === 'frame') {
      onFrame(msg).then(async (roomCode) => {
        if (!roomCode) return;
        try {
          if (looksFinished(JSON.parse(msg.data))) await finalise(roomCode);
        } catch { /* already filtered by onFrame */ }
      });
    } else if (msg.kind === 'close') {
      // The socket URL carries the room code; finalise anything still open.
      all(SESSIONS).then((sessions) => {
        for (const s of sessions) if (!s.finished) finalise(s.roomCode);
      });
    }
    return false;
  }

  if (msg?.type === 'list') {
    all(SESSIONS).then(async (sessions) => {
      const replays = await all(REPLAYS);
      const built = new Map(replays.map((r) => [r.roomCode, r]));
      sendResponse(sessions
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((s) => ({
          roomCode: s.roomCode,
          startedAt: s.startedAt,
          lastAt: s.lastAt,
          finished: s.finished === true,
          partial: s.partial === true,
          hasReplay: built.has(s.roomCode),
          match: built.get(s.roomCode)?.replay?.match ?? null,
          players: built.get(s.roomCode)?.replay?.players ?? null,
        })));
    });
    return true;
  }

  if (msg?.type === 'export') {
    (async () => {
      let row = await get(REPLAYS, msg.roomCode);
      if (!row) { await finalise(msg.roomCode); row = await get(REPLAYS, msg.roomCode); }
      if (!row) return sendResponse({ ok: false, error: 'nothing recorded for this room' });
      // A data: URL keeps the download entirely local; no blob URL, no fetch.
      const json = JSON.stringify(row.replay);
      const url = 'data:application/json;base64,'
        + btoa(String.fromCharCode(...new TextEncoder().encode(json)));
      chrome.downloads.download({ url, filename: `${msg.roomCode}.ratlas.json`, saveAs: true },
        () => sendResponse({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message }));
    })();
    return true;
  }

  if (msg?.type === 'finalise') {
    finalise(msg.roomCode).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'delete') {
    dropRoom(msg.roomCode).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'replayMode') {
    (async () => {
      const row = await get(REPLAYS, msg.roomCode);
      if (!row) return sendResponse({ ok: false, error: 'build the replay first' });

      const [tab] = await chrome.tabs.query({ url: 'https://play.riftatlas.com/*' });
      const target = tab ?? await chrome.tabs.create({ url: 'https://play.riftatlas.com/' });
      if (!tab) await new Promise((r) => setTimeout(r, 3500));
      await chrome.tabs.update(target.id, { active: true });

      // Arming and injection are two separate steps in the page's own world:
      // the replay is handed over first, then the injector consumes it.
      const armed = await chrome.scripting.executeScript({
        target: { tabId: target.id }, world: 'MAIN',
        func: (replay) => {
          if (window.__riftatlasLiveMatch) return { ok: false, error: 'a live match is open in this tab' };
          window.__riftatlasReplayArm = { replay };
          return { ok: true };
        },
        args: [row.replay],
      });
      const first = armed[0]?.result;
      if (!first?.ok) return sendResponse(first ?? { ok: false, error: 'could not arm' });

      await chrome.scripting.executeScript({
        target: { tabId: target.id }, world: 'MAIN',
        files: ['replay-mode/inject.js'],
      });
      sendResponse({ ok: true, roomCode: msg.roomCode });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg?.type === 'openPlayer') {
    chrome.tabs.create({ url: chrome.runtime.getURL('player/player.html') });
    return false;
  }

  return false;
});

void pendingFinalise;
