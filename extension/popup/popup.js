const list = document.getElementById('list');
const send = (msg) => chrome.runtime.sendMessage(msg);

document.getElementById('open-player').onclick = () => send({ type: 'openPlayer' });

document.getElementById('unstick').onclick = async (e) => {
  const button = e.currentTarget;
  const was = button.textContent;
  button.textContent = 'Clearing…';
  const res = await send({ type: 'clearRoomState' });
  button.textContent = res?.ok ? 'Done' : (res?.error ?? 'failed');
  setTimeout(() => { button.textContent = was; }, 2500);
};

document.getElementById('dump').onclick = async (e) => {
  const button = e.currentTarget;
  const was = button.textContent;
  button.textContent = 'Dumping…';
  const res = await send({ type: 'dump' });
  button.textContent = res?.ok ? 'Saved' : (res?.error ?? 'failed');
  setTimeout(() => { button.textContent = was; }, 2500);
};

function when(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function tag(text, cls) {
  const el = document.createElement('span');
  el.className = `tag ${cls}`;
  el.textContent = text;
  return el;
}

/** A small square action. Icons carry their meaning in the tooltip. */
function icon(glyph, title, onclick, cls = '') {
  const b = document.createElement('button');
  b.className = `icon ${cls}`.trim();
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.onclick = onclick;
  return b;
}

async function refresh() {
  const rows = await send({ type: 'list' });
  list.replaceChildren();
  if (!rows?.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No recordings yet. Open a RiftAtlas match to start one.';
    list.append(li);
    return;
  }

  for (const row of rows) {
    const id = row.roomCode;                       // recording id, for actions
    const code = row.room ?? row.roomCode;         // room code, for people
    const li = document.createElement('li');

    const main = document.createElement('div');
    main.className = 'main';

    // ---- left: who, when, and the small actions ----
    const info = document.createElement('div');
    info.className = 'info';

    const head = document.createElement('div');
    head.className = 'head';
    const room = document.createElement('span');
    room.className = 'room';
    room.textContent = code;
    head.append(room, icon('⎘', 'Copy the room code', async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(code); b.textContent = '✓'; }
      catch { b.textContent = '!'; }
      setTimeout(() => { b.textContent = '⎘'; }, 1200);
    }));
    if (!row.finished) head.append(tag('recording', 'live'));
    if (row.partial) head.append(tag('partial', 'partial'));
    if (row.stale) {
      const t = tag(`rebuild — ${row.builtCommits}/${row.recordedCommits}`, 'partial');
      t.title = `The replay covers ${row.builtCommits} of ${row.recordedCommits} recorded actions. `
        + 'Press rebuild to bring it up to date.';
      head.append(t);
    }
    info.append(head);

    const players = document.createElement('div');
    players.className = 'players';
    players.textContent = row.players?.map((p) => `${p.name} ${p.finalScore ?? ''}`.trim())
      .join('   v   ') ?? '';
    if (players.textContent) info.append(players);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [when(row.startedAt), row.match?.matchFormat].filter(Boolean).join('  ·  ');
    info.append(meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      icon('⤓', 'Export this match as a .ratlas.json file. Rebuilds first, '
        + 'so an export is always up to date.', async (e) => {
        const b = e.currentTarget;
        b.textContent = '…';
        const res = await send({ type: 'export', roomCode: id });
        b.textContent = res?.ok ? '✓' : '!';
        if (!res?.ok) meta.textContent = res?.error ?? 'export failed';
        setTimeout(() => { b.textContent = '⤓'; }, 1500);
      }),
      icon('⟳', 'Re-assemble the replay from what was recorded. Not normally '
        + 'needed — recording is continuous, and Export rebuilds anyway.', async (e) => {
        const b = e.currentTarget;
        b.textContent = '…';
        await send({ type: 'finalise', roomCode: id });
        refresh();
      }),
      icon('✕', 'Delete this recording', () => askDelete(li, code, id), 'danger'),
    );
    info.append(actions);
    main.append(info);

    // ---- right: the thing you actually came for ----
    const watch = document.createElement('button');
    watch.className = 'watch';
    watch.textContent = 'Watch replay';
    watch.title = 'Play this match back in RiftAtlas’ own board, with card art '
      + 'and their match log.';
    watch.onclick = async () => {
      watch.textContent = 'Opening…';
      const res = await send({ type: 'replayMode', roomCode: id });
      watch.textContent = 'Watch replay';
      if (!res?.ok) meta.textContent = res?.error ?? 'could not start the replay';
    };
    main.append(watch);

    li.append(main);
    list.append(li);
  }
}

/**
 * Deleting a recording destroys it, so it asks first — inline rather than with
 * confirm(), which can dismiss the whole popup on some platforms.
 */
function askDelete(li, code, id) {
  if (li.querySelector('.confirm')) return;
  const bar = document.createElement('div');
  bar.className = 'confirm';
  const text = document.createElement('span');
  text.textContent = `Delete the ${code} recording? This cannot be undone.`;
  const yes = document.createElement('button');
  yes.className = 'danger-solid';
  yes.textContent = 'Delete';
  yes.onclick = async () => { await send({ type: 'delete', roomCode: id }); refresh(); };
  const no = document.createElement('button');
  no.textContent = 'Cancel';
  no.onclick = () => bar.remove();
  bar.append(text, yes, no);
  li.append(bar);
  no.focus();
}

refresh();
