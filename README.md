# IBS India readiness hub

Governance tracker for the IBS India readiness programme. Migrated from the HTML prototype (Release 76 browser state).

## Migration importer

Turns the Release 76 authoritative browser-state export into relational tables.

```bash
node tools/import-release76.mjs <export.json> migration/output
```

- Uses the main `data` section as authoritative. `localState.ibsTracker` is a stale legacy copy and is excluded.
- Source values are never corrected or dropped. Problems are reported in `validation.json`.
- Output is written to `migration/output/`, which is git-ignored because it contains business data.
