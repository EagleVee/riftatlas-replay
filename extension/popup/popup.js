const list = document.getElementById('list');
const send = (msg) => chrome.runtime.sendMessage(msg);

document.getElementById('open-player').onclick = () => send({ type: 'openPlayer' });

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
    const li = document.createElement('li');

    const head = document.createElement('div');
    const room = document.createElement('span');
    room.className = 'room';
    room.textContent = row.roomCode;
    head.append(room);
    if (!row.finished) head.append(tag('recording', 'live'));
    if (row.partial) head.append(tag('partial', 'partial'));
    li.append(head);

    const sub = document.createElement('div');
    sub.className = 'sub';
    const names = row.players?.map((p) => `${p.name} ${p.finalScore ?? ''}`.trim()).join('  v  ');
    sub.textContent = [when(row.startedAt), names, row.match?.matchFormat].filter(Boolean).join('  ·  ');
    li.append(sub);

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.append(
      button('Export', async () => {
        const res = await send({ type: 'export', roomCode: row.roomCode });
        if (!res?.ok) sub.textContent = res?.error ?? 'export failed';
      }),
      button('In RiftAtlas UI', async () => {
        const res = await send({ type: 'replayMode', roomCode: row.roomCode });
        sub.textContent = res?.ok
          ? `replay mode armed — join room ${row.roomCode} in the lobby`
          : (res?.error ?? 'could not start replay mode');
      }),
      button(row.hasReplay ? 'Rebuild' : 'Build', async () => {
        await send({ type: 'finalise', roomCode: row.roomCode });
        refresh();
      }),
      button('Delete', async () => {
        await send({ type: 'delete', roomCode: row.roomCode });
        refresh();
      }),
    );
    li.append(actions);
    list.append(li);
  }
}

function tag(text, cls) {
  const el = document.createElement('span');
  el.className = `tag ${cls}`;
  el.textContent = text;
  return el;
}
function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

refresh();
