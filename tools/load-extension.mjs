#!/usr/bin/env node
/**
 * Load or reload the unpacked extension over the DevTools protocol.
 *
 * Chrome no longer honours `--load-extension`, and `Extensions.loadUnpacked`
 * lives on the BROWSER target rather than a page target, so this talks to the
 * browser WebSocket endpoint directly.
 *
 * Requires Chrome started with --remote-debugging-port and
 * --enable-unsafe-extension-debugging.
 *
 *   node tools/load-extension.mjs ./extension [port]
 */
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? './extension');
const port = process.argv[3] ?? '9222';

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);

const reply = await new Promise((resolve, reject) => {
  ws.onopen = () => ws.send(JSON.stringify({
    id: 1, method: 'Extensions.loadUnpacked', params: { path: dir },
  }));
  ws.onmessage = (event) => { resolve(JSON.parse(event.data)); ws.close(); };
  ws.onerror = () => reject(new Error('could not reach the browser target'));
  setTimeout(() => reject(new Error('timed out')), 15000);
});

if (reply.error) {
  console.error('failed:', reply.error.message);
  console.error('is Chrome running with --enable-unsafe-extension-debugging?');
  process.exit(1);
}
console.log(`loaded ${dir}\nextension id: ${reply.result.id}`);
