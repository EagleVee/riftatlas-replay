#!/usr/bin/env node
/**
 * Fetch and inspect the RiftAtlas production client bundles.
 *
 * Static analysis of the shipped JavaScript is how the action vocabulary, the
 * Solo Lab rules and the card catalog were established. Re-run it after a
 * RiftAtlas deploy to detect protocol drift.
 *
 *   npm i playwright && npx playwright install chromium
 *   node probe_client.mjs ./out
 *
 * Read-only: loads the public landing page, saves what the page fetches, and
 * signs in to nothing.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || './client-probe';
const ASSETS = path.join(OUT, 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const requests = [];
page.on('response', async (res) => {
  const ct = (res.headers()['content-type'] || '').split(';')[0];
  let saved = null;
  try {
    if (/javascript/.test(ct)) {
      const body = await res.body();
      if (body.length > 2000) {
        saved = path.join(ASSETS, path.basename(new URL(res.url()).pathname).replace(/[^\w.-]/g, '_'));
        fs.writeFileSync(saved, body);
      }
    }
  } catch { /* body unavailable for redirects and cached responses */ }
  requests.push({ url: res.url(), status: res.status(), contentType: ct, saved });
});

await page.goto('https://play.riftatlas.com/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3000);
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(requests, null, 1));
await browser.close();

// --- report -------------------------------------------------------------
const bundles = fs.readdirSync(ASSETS).map((f) => [f, fs.readFileSync(path.join(ASSETS, f), 'utf8')]);
const all = bundles.map(([, s]) => s).join('\n');

const union = (re) => [...new Set([...all.matchAll(re)].map((m) => m[1]))].sort();
const actions = union(/case"([a-z0-9_]{3,45})"/g);
const roomModes = union(/"(solo_lab|single_player|multiplayer|lobby|sealed)"/g);
const cardCodes = union(/"([A-Z]{2,4}-\d{3}[A-Z]?)"/g);

console.log(`bundles saved:      ${bundles.length} (${(all.length / 1e6).toFixed(1)} MB)`);
console.log(`action types:       ${actions.length}`);
console.log(`room modes:         ${roomModes.join(', ')}`);
console.log(`card codes:         ${cardCodes.length}`);
console.log('\ndeck / hidden-information actions:');
for (const a of actions.filter((a) => /deck|peek|draw|shuffle|reveal|hidden|take_|send_/.test(a))) {
  console.log('  ', a);
}
fs.writeFileSync(path.join(OUT, 'vocabulary.json'),
  JSON.stringify({ actions, roomModes, cardCodeCount: cardCodes.length }, null, 1));
console.log(`\nwrote ${path.join(OUT, 'vocabulary.json')}`);
