/**
 * Card costs and colours, read from RiftAtlas' own client as it loads.
 *
 * Cards on the match socket carry a name, a code and a type, but no cost and no
 * domain - the client looks those up by code in a catalog compiled into its
 * JavaScript. Rather than keep a stale copy in the extension, or download the
 * script a second time, this reads the catalog from the code the page is
 * already running. No request is made.
 *
 * RiftAtlas is bundled by Turbopack. Each chunk hands its modules to the page
 * with `globalThis.TURBOPACK.push([script, id, factory, ...])` - into a plain
 * array until the runtime starts, and to the runtime's own `push` after that.
 * The runtime then hides the factories away, so this has to see them go past.
 * It watches that one property, the same way socket-observer.js watches
 * `WebSocket`:
 *
 *   - Every value is passed through unchanged; every push still reaches the
 *     runtime with the same arguments, and its result is returned.
 *   - Nothing is ever called, only read: a factory's source text comes from
 *     `Function.prototype.toString`, which runs none of its code.
 *   - Any failure here is swallowed. The page must never notice this exists.
 *
 * The same way it picks up the version tag RiftAtlas puts on each card image
 * (`small-v2/RAD-116.webp?v=68dc142ccf5a1a46`). Asking for an image with the
 * tag is asking for the very file the board already loaded, so the browser
 * answers from its cache; without it, the same picture is downloaded again.
 *
 * Best effort by design. If the bundle changes shape and nothing parses, every
 * card simply falls back to its name and type, and pictures to an untagged
 * address.
 */
(() => {
  if (window.__riftatlasCatalogObserved) return;
  window.__riftatlasCatalogObserved = true;

  const SOURCE = 'riftatlas-replay-catalog';
  // A catalog entry, as the minifier writes it:
  //   {id:"VEN-075",name:"Platewyrm Egg",energyCost:3,type:"Gear",domains:["Body"],...}
  const ENTRY = /\{id:"([A-Z0-9]+-\d+[A-Za-z]*)",name:"/g;
  const MAX_ENTRY = 4000;   // rules text included; far past any real card
  const toSource = Function.prototype.toString;

  /** code -> { energyCost, powerCost, domains } for every entry in `source`. */
  function parseCatalog(source) {
    const out = {};
    const starts = [...source.matchAll(ENTRY)];
    starts.forEach((m, i) => {
      const end = Math.min(starts[i + 1]?.index ?? Infinity, m.index + MAX_ENTRY);
      const body = source.slice(m.index, end);
      const energy = /[,{]energyCost:(\d+)/.exec(body);
      if (!energy) return;
      const power = /[,{]powerCost:(\d+)/.exec(body);
      const domains = /[,{]domains:\[([^\]]*)\]/.exec(body);
      out[m[1]] = {
        energyCost: Number(energy[1]),
        powerCost: power ? Number(power[1]) : 0,
        domains: domains
          ? [...domains[1].matchAll(/"([^"]+)"/g)].map((d) => d[1]).filter((d) => d !== 'Unknown')
          : [],
      };
    });
    return out;
  }

  // "RAD-116.webp":"68dc142ccf5a1a46" - one per card image.
  const REVISION = /"([A-Z0-9]{2,5}-[A-Z0-9]+)\.webp":"([0-9a-f]{8,32})"/g;

  /** code -> image version tag, for every pair in `source`. */
  function parseRevisions(source) {
    const out = {};
    for (const m of source.matchAll(REVISION)) out[m[1]] ??= m[2];
    return out;
  }

  let found = null;
  let revisions = null;
  const waiting = [];
  let scheduled = false;

  /**
   * Look at chunks later, not while the page is loading them: reading source
   * text is cheap, but the page's own start-up comes first.
   */
  function consider(entry) {
    if ((found && revisions) || !Array.isArray(entry)) return;
    waiting.push(entry);
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 0);
  }

  function scan() {
    scheduled = false;
    let changed = false;
    while (!(found && revisions) && waiting.length) {
      for (const item of waiting.shift()) {
        if (typeof item !== 'function') continue;
        let source;
        try { source = toSource.call(item); } catch { continue; }
        // A handful of matches is a stray object, not the real thing.
        if (!found && source.includes('energyCost:') && source.includes('domains:[')) {
          const catalog = parseCatalog(source);
          if (Object.keys(catalog).length > 100) { found = catalog; changed = true; }
        }
        if (!revisions && source.includes('.webp":"')) {
          const tags = parseRevisions(source);
          if (Object.keys(tags).length > 100) { revisions = tags; changed = true; }
        }
      }
    }
    if (found && revisions) waiting.length = 0;
    if (changed) announce();
  }

  function announce() {
    try {
      window.postMessage({ source: SOURCE, catalog: found ?? {}, revisions: revisions ?? {} }, window.location.origin);
    } catch { /* going away */ }
  }

  // The overlay may start listening after the catalog went past; it can ask.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== SOURCE || event.data.ask !== true) return;
    if (found || revisions) announce();
  });

  /** Watch the runtime's `push`, passing every call straight through. */
  function observePush(target) {
    if (!target || typeof target.push !== 'function' || Array.isArray(target)) return target;
    const push = target.push;
    target.push = function (...args) {
      try { consider(args[0]); } catch { /* never the page's problem */ }
      return push.apply(this, args);
    };
    return target;
  }

  let current = globalThis.TURBOPACK;
  try {
    Object.defineProperty(globalThis, 'TURBOPACK', {
      configurable: true,
      enumerable: true,
      get() { return current; },
      set(value) {
        // Chunks that loaded before the runtime are still sitting in the array
        // it is about to replace. The array itself stays as it was.
        try { if (Array.isArray(current) && current !== value) current.forEach(consider); } catch { /* ignore */ }
        try { current = observePush(value); } catch { current = value; }
      },
    });
  } catch { /* the property is not ours to watch; no costs, then */ }
})();
