/**
 * The reveals panel: a list of what the opponent showed and hid again, and the
 * cards in each.
 *
 * Shared by the two places that open it - the in-game overlay
 * (content/overlay.js, isolated world) and replay mode's control bar
 * (replay-mode/inject.js, main world). It is a classic script rather than a
 * module so it can sit in front of either; each world gets its own copy.
 *
 * It draws inside its own closed shadow root, so neither RiftAtlas' styles nor
 * the host's reach it, and it never decides where it sits on screen - the
 * caller places `element`.
 */
(() => {
  if (globalThis.riftatlasRevealPanel) return;

  const DOMAIN_COLOURS = {
    Fury: '#e5484d', Calm: '#3fb27f', Mind: '#3b8eea',
    Body: '#f08c2e', Chaos: '#9b62d9', Order: '#e2bd3f',
  };
  const NEUTRAL = '#6b7d90';

  /**
   * Card art, at the address RiftAtlas' own client uses for cards in hand and
   * on the board. The board drew these cards when they were revealed, so the
   * browser usually has them already. Only the small size is ever used here;
   * the larger preview is the same image, drawn bigger.
   */
  const ART = 'https://assets.riftatlas-workers.com/riftbound/cards/small-v2/';
  const CARD_CODE = /^[A-Z0-9]{2,5}-[A-Z0-9]+$/;
  const artFor = (code, tag) => {
    if (!code || !CARD_CODE.test(code)) return null;
    // The client's own version tag makes this the exact file it loaded.
    return tag ? `${ART}${code}.webp?v=${encodeURIComponent(tag)}` : `${ART}${code}.webp`;
  };

  const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const BACK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const svg = (markup) => {
    const span = el('span', 'svg');
    span.innerHTML = markup;   // static, ours
    return span;
  };

  const titleCase = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  /**
   * Back-to-back reveals of the same cards, as one entry shown `count` times.
   *
   * `events` is newest first. "Back to back" means nothing else was revealed in
   * between, by anyone. A run keeps its oldest reveal's id, so it stays the same
   * entry while later repeats join it; everything shown comes from the newest.
   */
  function group(events) {
    const runs = [];
    for (const e of events) {
      const run = runs.at(-1);
      if (run && e.signature && run.signature === e.signature) {
        run.count++;
        run.id = e.id;
        run.firstTurn = e.turn;
        continue;
      }
      runs.push({ ...e, count: 1, firstTurn: e.turn, latest: e });
    }
    return runs;
  }

  const turns = (g) => (g.turn == null ? null
    : g.firstTurn != null && g.firstTurn !== g.turn ? `Turns ${g.firstTurn}–${g.turn}` : `Turn ${g.turn}`);
  const whose = (e) => `${e.playerName || 'Opponent'}’s ${e.kind === 'hand' ? 'hand' : 'top deck'}`;

  /**
   * A panel. `onClose` runs when its close button is pressed; `onJump`, when
   * given, adds a button to each reveal that takes the board to it.
   */
  function create({ onClose, onJump = null, emptyText }) {
    const element = document.createElement('div');
    element.style.cssText = 'all: initial; display: block;';
    const root = element.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = CSS;
    // One enlarged copy of whichever thumbnail is hovered, outside the panel
    // so its scrolling cannot clip it.
    const preview = el('img', 'preview');
    preview.alt = '';
    preview.hidden = true;
    root.append(style, preview);

    let events = [];   // grouped
    let catalog = new Map();
    let revisions = new Map();
    let selected = null;
    let drawn = null;

    function render() {
      // Redrawing what is already there would reset the scroll under the reader.
      const key = JSON.stringify([selected, catalog.size, revisions.size, events.map((e) => `${e.id}x${e.count}`)]);
      if (key === drawn) return;
      drawn = key;
      preview.hidden = true;
      for (const node of [...root.childNodes]) if (node !== style && node !== preview) node.remove();
      const box = el('section', 'panel');
      const event = events.find((e) => e.id === selected);
      if (event) detail(box, event); else list(box);
      root.append(box);
    }

    function list(box) {
      const head = el('header');
      head.append(el('h2', null, 'Revealed, then hidden'), closeButton());
      box.append(head);
      if (!events.length) { box.append(el('p', 'empty', emptyText)); return; }


      const ul = el('ul', 'events');
      for (const e of events) {
        const li = el('li');
        const button = el('button', 'event');
        button.type = 'button';
        const meta = el('span', 'meta', [
          turns(e),
          `${e.cards.length} card${e.cards.length === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' · '));
        const names = el('span', 'names', e.cards.map((c) => c.name).join(', '));
        const what = el('span', 'what', whose(e));
        if (e.count > 1) what.append(times(e.count));
        button.append(what, meta, names);
        button.onclick = () => { selected = e.id; render(); };
        li.append(button);
        ul.append(li);
      }
      box.append(ul);
    }

    function detail(box, event) {
      const head = el('header');
      const back = el('button', 'icon');
      back.type = 'button';
      back.title = 'Back to the list';
      back.setAttribute('aria-label', back.title);
      back.append(svg(BACK));
      back.onclick = () => { selected = null; render(); };
      const title = el('h2', null, whose(event));
      if (event.count > 1) title.append(times(event.count));
      head.append(back, title, closeButton());
      box.append(head);

      const sub = el('div', 'sub');
      const when = [turns(event), event.count > 1 ? `shown ${event.count} times in a row` : null]
        .filter(Boolean).join(' · ');
      if (when) sub.append(el('span', null, when));
      if (onJump) {
        const jump = el('button', 'jump', 'Show on board');
        jump.type = 'button';
        jump.title = event.count > 1
          ? 'Move the replay to the last time these cards were showing'
          : 'Move the replay to when these cards were showing';
        // The newest showing; the entry keeps its own id so it stays open.
        jump.onclick = () => onJump({ ...event.latest, id: event.id });
        sub.append(jump);
      }
      if (sub.childNodes.length) box.append(sub);

      box.append(cardList(event.cards.filter((c) => !c.later)));
      const later = event.cards.filter((c) => c.later);
      if (later.length) {
        // Cards that joined the reveal after it began: drawn into a revealed
        // hand, or revealed one at a time.
        box.append(el('h3', null, 'Revealed later, before it was hidden'));
        box.append(cardList(later));
      }
    }

    /** The hovered thumbnail, bigger, beside the panel on whichever side has room. */
    function showPreview(art) {
      if (!art.complete || !art.naturalWidth) return;
      const W = 220;
      const H = Math.round(W * (art.naturalHeight / art.naturalWidth));
      const row = art.getBoundingClientRect();
      const panelBox = root.querySelector('.panel')?.getBoundingClientRect() ?? row;
      const left = panelBox.left - W - 10 >= 8 ? panelBox.left - W - 10 : panelBox.right + 10;
      const top = Math.min(Math.max(8, row.top + row.height / 2 - H / 2), window.innerHeight - H - 8);
      preview.src = art.src;
      Object.assign(preview.style, { left: `${left}px`, top: `${top}px`, width: `${W}px`, height: `${H}px` });
      preview.hidden = false;
    }

    function times(n) {
      const tag = el('span', 'times', `×${n}`);
      tag.title = `Shown ${n} times in a row`;
      return tag;
    }

    function closeButton() {
      const button = el('button', 'icon');
      button.type = 'button';
      button.title = 'Close';
      button.setAttribute('aria-label', 'Close');
      button.append(svg(CLOSE));
      button.onclick = () => { selected = null; onClose?.(); };
      return button;
    }

    function cardList(cards) {
      const ul = el('ul', 'cards');
      for (const card of cards) {
        const info = catalog.get(card.cardCode);
        const colours = (info?.domains ?? []).map((d) => DOMAIN_COLOURS[d] ?? NEUTRAL);
        const li = el('li', 'card');
        const stripe = el('span', 'stripe');
        stripe.style.background = colours.length > 1
          ? `linear-gradient(${colours[0]} 50%, ${colours[1]} 50%)`
          : (colours[0] ?? NEUTRAL);
        li.append(stripe);

        const src = artFor(card.cardCode, revisions.get(card.cardCode));
        if (src) {
          const frame = el('span', 'art');
          const art = el('img');
          art.alt = '';
          art.loading = 'lazy';
          art.decoding = 'async';
          art.src = src;
          // No picture is better than a broken one; the row reads without it.
          art.onerror = () => { frame.remove(); li.classList.remove('zoom'); };
          // The whole row previews the card, not just the thumbnail.
          li.classList.add('zoom');
          li.onmouseenter = () => showPreview(art);
          li.onmouseleave = () => { preview.hidden = true; };
          frame.append(art);
          li.append(frame);
        }

        if (info) {
          const cost = el('span', 'cost');
          cost.append(el('span', 'energy', String(info.energyCost)));
          for (let i = 0; i < info.powerCost; i++) {
            const pip = el('span', 'pip');
            pip.style.background = colours[i % Math.max(colours.length, 1)] ?? NEUTRAL;
            cost.append(pip);
          }
          cost.title = `${info.energyCost} energy${info.powerCost ? ` + ${info.powerCost} power` : ''}`;
          li.append(cost);
        }

        const text = el('span', 'text');
        text.append(el('span', 'name', card.name || card.cardCode || 'Unknown card'));
        text.append(el('span', 'type', [titleCase(card.type), info?.domains?.join(' / ')]
          .filter(Boolean).join(' · ')));
        li.append(text);
        ul.append(li);
      }
      return ul;
    }

    return {
      element,
      /** Show these reveals, keeping the open one open while it still exists. */
      update(nextEvents, nextCatalog = catalog, nextRevisions = revisions) {
        events = group(nextEvents ?? []);
        catalog = nextCatalog ?? new Map();
        revisions = nextRevisions ?? new Map();
        if (selected && !events.some((e) => e.id === selected)) selected = null;
        render();
      },
      /** Back to the list, as when it is next opened. */
      reset() { selected = null; render(); },
    };
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible { outline: 2px solid #74efff; outline-offset: 2px; }
    .svg { display: grid; place-items: center; }
    .panel { width: min(320px, calc(100vw - 32px)); max-height: min(440px, calc(100vh - 90px));
      overflow-y: auto; background: #0b1017; border: 1px solid #24313f; border-radius: 10px;
      padding: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.55); color: #dbe7f3;
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: left; }
    header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    h2 { flex: 1; margin: 0; font-size: 13px; font-weight: 600; color: #d8b76e; letter-spacing: .02em; }
    h3 { margin: 10px 0 6px; font-size: 11px; font-weight: 600; color: #8698ab;
      text-transform: uppercase; letter-spacing: .06em; }
    .icon { width: 26px; height: 26px; padding: 0; border-radius: 5px; border: 1px solid transparent;
      background: none; color: #8698ab; display: grid; place-items: center; }
    .icon:hover { color: #dbe7f3; border-color: #24313f; }
    .sub { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin: -4px 0 8px; color: #7d8fa2; font-size: 11.5px; }
    .jump { margin-left: auto; padding: 2px 8px; font-size: 11.5px; border-radius: 4px;
      border: 1px solid #24313f; background: #121a24; color: #9fb0c2; }
    .jump:hover { border-color: #74efff; color: #dbe7f3; }
    .empty { margin: 0; color: #8698ab; font-size: 12px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .event { width: 100%; text-align: left; display: grid; gap: 1px; padding: 7px 9px;
      background: #121a24; border: 1px solid #24313f; border-radius: 6px; }
    .event:hover { border-color: #74efff; }
    .what { font-weight: 600; }
    .times { margin-left: 6px; padding: 0 5px; border-radius: 3px; font-size: 10.5px; font-weight: 700;
      color: #0b1017; background: #d8b76e; vertical-align: 1px; }
    .meta { color: #7d8fa2; font-size: 11px; }
    .names { color: #9fb0c2; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card { display: flex; align-items: center; gap: 9px; padding: 6px 9px 6px 0; background: #121a24;
      border: 1px solid #24313f; border-radius: 6px; overflow: hidden; }
    .stripe { align-self: stretch; width: 4px; flex: 0 0 auto; }
    /* A square from the top of the card: the artwork and its name banner, which
       ends about 64% of the way down. A full-width square would reach 72% and
       catch the rules text, so the card is drawn 12% wider than the square and
       centred, which makes the square end at the banner. */
    .art { position: relative; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 4px;
      overflow: hidden; background: #0d141c; }
    .art img { position: absolute; top: 0; left: -6%; width: 112%; height: auto; }
    .card.zoom { cursor: zoom-in; }
    .card.zoom:hover { border-color: #33465a; }
    .preview { position: fixed; z-index: 1; border-radius: 10px; pointer-events: none;
      box-shadow: 0 12px 34px rgba(0,0,0,.65); background: #0d141c; }
    .preview[hidden] { display: none; }
    .cost { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; min-width: 46px; }
    .energy { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
      background: #dbe7f3; color: #0b1017; font-weight: 700; font-size: 12px;
      font-variant-numeric: tabular-nums; }
    .pip { width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(0,0,0,.4); }
    .text { display: grid; min-width: 0; }
    .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .type { color: #7d8fa2; font-size: 11px; }
  `;

  globalThis.riftatlasRevealPanel = { create, group, EYE };
})();
