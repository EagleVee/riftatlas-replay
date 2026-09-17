/**
 * Service worker: routes observed frames into the recorder and serves the popup.
 *
 * Holds no match state. MV3 will terminate this worker repeatedly during a
 * match; everything it learns is already in IndexedDB by the time the message
 * handler returns, so a restart is invisible.
 */
import { onFrame, looksFinished, everyoneLeft } from './recorder.js';
import { buildReplay } from './finalise.js';
import { SESSIONS, COMMITS, EXTRAS, REPLAYS, all, get, put, dropRecording, commitsFor, roomOf, isEmptyRecording } from './store.js';

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

/**
 * Close a recording: mark it done, then build its replay.
 *
 * Closing and building are separate on purpose. Building can fail - a recording
 * that never caught an anchoring snapshot has nothing to build from - and an
 * earlier version left such a recording open forever, so the next match in the
 * same room code was appended to it and the two merged. A recording that has
 * ended is ended whether or not a replay came out of it.
 */
async function finalise(recordingId, { close = true } = {}) {
  if (close) {
    try {
      const session = await get(SESSIONS, recordingId);
      if (session && !session.finished) {
        session.finished = true;
        await put(SESSIONS, session);
      }
    } catch (err) {
      console.warn('[riftatlas-replay] could not close', recordingId, err.message);
    }
  }
  try {
    const replay = await buildReplay(recordingId);
    await put(REPLAYS, { roomCode: recordingId, builtAt: Date.now(), replay });
    const session = await get(SESSIONS, recordingId);
    if (session?.buildError) { delete session.buildError; await put(SESSIONS, session); }
    pendingFinalise.delete(recordingId);
  } catch (err) {
    // Record why, and show it. A build can fail for a reason worth acting on -
    // a patch verb the reducer predates, say - and a console warning nobody
    // reads made that look like a button that simply does nothing.
    console.warn('[riftatlas-replay] could not build', recordingId, err.message);
    try {
      const session = await get(SESSIONS, recordingId);
      if (session) { session.buildError = String(err?.message ?? err); await put(SESSIONS, session); }
    } catch { /* the session is gone */ }
  }
}

/**
 * The room whose frames we saw last. A different one means the previous match
 * is over, whatever its log did or did not say.
 */
let currentRoom = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'observer') {
    if (msg.kind === 'frame') {
      // Acknowledge only once the frame is persisted, and keep the port open
      // until then by returning true.
      //
      // This is the frame-loss bug. Handling the frame without an
      // acknowledgement and returning false told Chrome the listener was done,
      // so sendMessage resolved before anything reached IndexedDB. The bridge
      // counted the frame delivered and moved on, and if the worker was then
      // stopped mid-write - which MV3 does freely - the frame was gone with
      // nothing to retry. One real match lost 28 commits that way and replayed
      // as nine moves out of 396.
      onFrame(msg).then(async (roomCode) => {
        sendResponse({ ok: true });
        if (!roomCode) return;

        // A new room started: whatever came before it is finished.
        if (currentRoom && currentRoom !== roomCode) {
          const previous = currentRoom;
          currentRoom = roomCode;
          await finalise(previous);
        } else {
          currentRoom = roomCode;
        }

        // Everyone has left the room. Steadier than reading the log, and the
        // reason finalisation no longer hangs on spotting a victory line.
        const session = await get(SESSIONS, roomCode);
        if (everyoneLeft(session)) { await finalise(roomCode); return; }

        // Last and least: the log looks like an ending. Only a hint - it has
        // been wrong before, and a closing socket rebuilds regardless.
        try {
          if (looksFinished(JSON.parse(msg.data))) await finalise(roomCode);
        } catch { /* already filtered by onFrame */ }
      }).catch((error) => {
        // Nothing was stored. Say so, so the bridge sends it again.
        sendResponse({ ok: false, error: String(error?.message ?? error) });
      });
      return true;
    }

    if (msg.kind === 'close') {
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
      // One pass over the commits rather than a range query per recording:
      // with a long history that difference is the popup feeling instant or not.
      const counts = new Map();
      for (const c of await all(COMMITS)) {
        counts.set(c.roomCode, (counts.get(c.roomCode) ?? 0) + 1);
      }
      // A session that has caught nothing is not a recording, and is never
      // listed. Ending a match is the usual way one appears: finalise closes
      // the recording, then the trailing frames - a shell sync as the client
      // returns to the room - find no open recording and start an empty one,
      // which then sits above the real match wearing the same room code.
      //
      // They are hidden immediately and deleted once they cannot still be a
      // match in the act of starting: a shell sync does arrive a beat before
      // the opening snapshot, and in that beat the two look identical.
      const SETTLE_MS = 2 * 60 * 1000;
      const now = Date.now();
      const live = [];
      for (const s of sessions) {
        if (!isEmptyRecording(s, counts.get(s.roomCode))) { live.push(s); continue; }
        if (now - (s.lastAt ?? 0) > SETTLE_MS) dropRecording(s.roomCode).catch(() => {});
      }

      const rows = await Promise.all(live
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(async (s) => {
          const replay = built.get(s.roomCode)?.replay ?? null;
          const recorded = counts.get(s.roomCode) ?? 0;
          return {
            roomCode: s.roomCode,               // the recording id, used by actions
            room: s.room ?? roomOf(s.roomCode),  // the code a person recognises
            startedAt: s.startedAt,
            lastAt: s.lastAt,
            finished: s.finished === true,
            partial: s.partial === true,
            hasReplay: !!replay,
            builtAt: built.get(s.roomCode)?.builtAt ?? null,
            recordedCommits: recorded,
            builtCommits: replay?.commits?.length ?? 0,
            // A built replay can fall behind its recording - an early finalise
            // once froze one at the dice roll while recording carried on. Say
            // so rather than letting a short replay look like a short match.
            stale: !!replay && replay.commits.length < recorded,
            match: replay?.match ?? null,
            players: replay?.players ?? null,
            viewerPlayerId: replay?.viewer?.playerId ?? null,
            buildError: s.buildError ?? null,
          };
        }));
      sendResponse(rows);
    });
    return true;
  }

  if (msg?.type === 'export') {
    (async () => {
      // Rebuild first, always. A replay built earlier in the match can be
      // behind the recording, and exporting a stale one is how a complete
      // recording leaves as a short replay.
      await finalise(msg.roomCode, { close: false });
      const row = await get(REPLAYS, msg.roomCode);
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
    // Rebuilding is not the same as ending: a match still in progress must stay
    // open so its later frames keep landing in the same recording.
    finalise(msg.roomCode, { close: false }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'delete') {
    dropRecording(msg.roomCode).then(() => sendResponse({ ok: true }));
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

  if (msg?.type === 'clearRoomState') {
    // Forget whatever room the client thinks it is in. The way out of
    // "Couldn't reconnect to your game" when a replay left its room behind.
    (async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://play.riftatlas.com/*' });
      if (!tab) return sendResponse({ ok: false, error: 'open play.riftatlas.com first' });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: () => {
          localStorage.removeItem('riftbound_simulator_last_room');
          sessionStorage.removeItem('riftbound_simulator_active_room');
        },
      });
      await chrome.tabs.update(tab.id, { active: true, url: 'https://play.riftatlas.com/' });
      sendResponse({ ok: true });
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
