# Evidence

Derived, redacted artifacts only. **Raw `*.har` and `*.jsonl` captures are
gitignored** — they contain live JWTs, party keys and player names.

| File | Source |
|---|---|
| `capture-3NKJ3-analysis.md` | `tools/analyze.py` over the reference capture: one ranked constructed Bo1 duel, room `3NKJ3`, 19.4 min, 2207 frames, recorded from seat 1 (`plr_135347f2`), ending in concession at sequence 370. |
| `local-state/localstorage-play.riftatlas.com.json` | Client localStorage, 2026-09-16, signed-in player seat. JSON-encoded values expanded. Contains no credential — the Clerk session lives in cookies. |

To regenerate, or to add a capture:

```bash
python3 tools/har_to_jsonl.py capture.har frames.jsonl
python3 tools/verify.py frames.jsonl
python3 tools/analyze.py frames.jsonl > evidence/capture-<room>-analysis.md
```

Keep the raw capture outside the repo.
