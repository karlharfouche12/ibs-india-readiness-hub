# IBS India readiness hub

Governance tracker for the IBS India readiness programme. Migrated from the HTML prototype (Release 76 browser state).

## Layout

- `src/`: React + TypeScript UI (leadership cockpit, issue register, issue detail).
- `server/`: Node 22 API and static server. SQLite via built-in `node:sqlite`. See [ADR 0001](docs/adr/0001-platform-and-stack.md).
- `tools/import-release76.mjs`: turns the Release 76 browser-state export into relational tables.
- `tests/`: API, identity and HTTP tests. Fixtures are synthetic.

## Run locally

```bash
npm install
node tools/import-release76.mjs <export.json> migration/output
npm run seed -- migration/output
npm run build
npm start
```

Then open http://127.0.0.1:8787. Locally you are signed in as `HUB_DEV_USER` (default `local-dev`).

```bash
npm test
```

## Data and privacy

- `migration/output/`, `data/` and `dist/` are git-ignored. They hold business data or build output and never go in the repo.
- Writes record the signed-in user. In Azure, that identity comes from App Service authentication, and requests without it are refused.

## Not done yet

- Azure App Service hosting, the GitHub Actions deploy workflow and Entra ID sign-in need platform approval and setup.
- The prototype's Outlook email capture review, reports, decisions log, weekly review and governance settings are not ported yet.
- UI components should move to the Maersk Design System before go-live.
