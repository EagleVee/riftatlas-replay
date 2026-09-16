#!/usr/bin/env node
/**
 * Prove reducer.js reproduces the server's own snapshots, exactly as
 * tools/verify.py does for reducer.py. Run both on the same capture; they must
 * agree line for line.
 *
 *   node tests/reducer-parity.mjs <frames.jsonl>
 */
import fs from 'node:fs';
import { Timeline, SNAPSHOT_ONLY_PLAYER_FIELDS } from '../extension/shared/reducer.js';

const framesPath = process.argv[2];
if (!framesPath) { console.error('usage: reducer-parity.mjs <frames.jsonl>'); process.exit(2); }

/** Stable stringify so key order never affects the comparison. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function stripSnapshotOnly(state) {
  const copy = structuredClone(state);
  for (const p of copy.players ?? []) for (const f of SNAPSHOT_ONLY_PLAYER_FIELDS) delete p[f];
  return copy;
}

const timeline = new Timeline();
for (const line of fs.readFileSync(framesPath, 'utf8').split('\n')) {
  if (line.trim()) timeline.ingest(JSON.parse(line).msg);
}

let checked = 0, failed = 0;
for (const [seq, [snapState, snapLog]] of [...timeline.snapshots].sort((a, b) => a[0] - b[0])) {
  if (!timeline.commits.has(seq)) continue;   // adopted, not reduced into: nothing to prove
  const [ourState, ourLog] = timeline.states.get(seq);
  checked++;
  const stateOk = canonical(stripSnapshotOnly(ourState)) === canonical(stripSnapshotOnly(snapState));
  const logOk = canonical(ourLog) === canonical(snapLog);
  if (stateOk && logOk) {
    console.log(`sequence ${seq}: reduced state matches snapshot`);
  } else {
    failed++;
    console.log(`sequence ${seq}: MISMATCH (state ${stateOk ? 'ok' : 'DIFF'}, log ${logOk ? 'ok' : 'DIFF'})`);
  }
}
for (const { from, to } of timeline.resyncs) {
  console.log(`resync: server re-anchored ${from} -> ${to}; ${to - from} commit(s) never reached this client`);
}
const seqs = timeline.sequences;
console.log(`\n${seqs.length} sequences materialised (${seqs[0]}..${seqs.at(-1)}), ${checked} snapshot checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
