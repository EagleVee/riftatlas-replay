/**
 * Service worker: routes observed frames into the recorder and serves the popup.
 *
 * Holds no match state. MV3 will terminate this worker repeatedly during a
 * match; everything it learns is already in IndexedDB by the time the message
 * handler returns, so a restart is invisible.
 */
import { onFrame, looksFinished } from './recorder.js';
import { buildReplay } from './finalise.js';
import { SESSIONS, COMMITS, EXTRAS, REPLAYS, all, get, put, dropRoom } from './store.js';

/**
 * Build a data: URL for a download. Chunked, because spreading a large array
 * into String.fromCharCode overflows the call stack - which is exactly how the
 * first export silently did nothing at all.
 */
function jsonDataUrl(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:application/json;base64,' + btoa(binary);
}

/** Rooms whose socket closed or whose log announced a result, awaiting finalise. */
const pendingFinalise = new Set();

const ARMING_SCRIPTS = [
  {
    id: 'riftatlas-replay-arm',
    matches: ['https://play.riftatlas.com/*'],
    js: ['replay-mode/arm.js'],
    runAt: 'document_start',
    world: 'ISOLATED',
  },
  {
    id: 'riftatlas-replay-inject',
    matches: ['https://play.riftatlas.com/*'],
    js: ['replay-mode/inject.js'],
    runAt: 'document_start',
    world: 'MAIN',
  },
];

async function registerArmingScripts() {
  await unregisterArmingScripts();
  // Session storage is closed to content scripts by default, so arm.js would
  // read nothing. Widen it for the pending replay handover.
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
  }).catch(() => {});
  await chrome.scripting.registerContentScripts(ARMING_SCRIPTS);
}

async function unregisterArmingScripts() {
  const ids = ARMING_SCRIPTS.map((s) => s.id);
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
    }
  } catch { /* nothing registered */ }
}

// Never carry an arming registration across a browser restart.
chrome.runtime.onStartup.addListener(() => {
  unregisterArmingScripts();
  chrome.storage.session.remove('pendingReplay').catch(() => {});
});

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
      // Rebuild every session, finished or not. An early finalise - the
      // initiative roll once read as a victory - must never be the last word,
      // or the replay stays frozen wherever the detector misfired.
      all(SESSIONS).then((sessions) => {
        for (const s of sessions) finalise(s.roomCode);
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
      const url = jsonDataUrl(row.replay);
      chrome.downloads.download({ url, filename: `${msg.roomCode}.ratlas.json`, saveAs: true },
        () => sendResponse({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message }));
      return;
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
      if (!tab) {
        return sendResponse({ ok: false, error: 'open play.riftatlas.com first' });
      }

      // Replay mode must install before the page opens its match socket, about
      // two seconds into load. So park the replay, register the arming scripts
      // at document_start, and reload the tab - arming after the fact loses the
      // race and replay mode rightly refuses to displace a real socket.
      await chrome.storage.session.set({ pendingReplay: row.replay });
      await registerArmingScripts();
      await chrome.tabs.update(tab.id, { active: true, url: 'https://play.riftatlas.com/game' });
      sendResponse({ ok: true, roomCode: msg.roomCode });
    })().catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg?.type === 'replayModeArmed') {
    // Armed exactly once; take the scripts back out so replay mode is not
    // sitting on every future page load.
    unregisterArmingScripts();
    return false;
  }

  if (msg?.type === 'dump') {
    // Everything the recorder holds, for a bug report: raw commits and
    // snapshots included, so a recording that will not finalise can still be
    // diagnosed. Carries decklists and player names, but no credentials -
    // handshake frames are dropped before anything is stored.
    (async () => {
      try {
        const dump = {
          dumpedAt: new Date().toISOString(),
          extensionVersion: chrome.runtime.getManifest().version,
          sessions: await all(SESSIONS),
          commits: await all(COMMITS),
          extras: await all(EXTRAS),
          replays: await all(REPLAYS),
        };
        chrome.downloads.download(
          { url: jsonDataUrl(dump), filename: 'riftatlas-replay-debug.json', saveAs: false },
          () => sendResponse({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message }));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg?.type === 'prefillLobby') {
    // Fills RiftAtlas' own room-code box and presses Join. This reaches the
    // REAL room on their server, not a replay - useful while a room still
    // exists, and it shows the live board with no history. Replay mode is the
    // one that plays a match back.
    (async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://play.riftatlas.com/*' });
      if (!tab) return sendResponse({ ok: false, error: 'open play.riftatlas.com first' });
      await chrome.tabs.update(tab.id, { active: true });
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [msg.roomCode],
        func: (code) => {
          const input = [...document.querySelectorAll('input')]
            .find((i) => /AB12CD/i.test(i.placeholder ?? ''));
          if (!input) return { ok: false, error: 'no room-code box — are you in the lobby?' };
          // The box is React-controlled, so assigning .value is ignored; go
          // through the native setter and announce the change.
          const proto = Object.getPrototypeOf(input);
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, code);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          const join = [...document.querySelectorAll('button')]
            .find((b) => /join\s*\/?\s*spectate/i.test(b.innerText ?? ''));
          if (!join) return { ok: true, filled: true, pressed: false };
          setTimeout(() => join.click(), 150);
          return { ok: true, filled: true, pressed: true };
        },
      });
      sendResponse(result ?? { ok: false, error: 'could not reach the page' });
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
