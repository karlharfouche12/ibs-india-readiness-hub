# ADR 0001: Platform and stack

Status: Proposed (pending platform owner confirmation)
Date: 2026-10-20

## Context

The IBS India readiness hub is a single-file HTML prototype (Release 76) that keeps all data in each user's browser. It needs a shared database, a named user on every change, and a hosted web address for the team.

No platform was specified by the team, so the choice follows what Maersk teams already run. Evidence from Maersk-Global:

- `APMT-OT-A-Governance-Dashboard` is the closest peer: a governance dashboard built with React, TypeScript and Vite. It has a small Node server (`server/pilot.mjs`) using Node's built-in SQLite, and deploys to Azure App Service through GitHub Actions (`azure/webapps-deploy`).
- At least eight other repos deploy to Azure App Service or Azure Static Web Apps.
- `technology-patterns` lists the Maersk Design System (MDS) as the approved UI component library, and it has been reviewed by Security and Enterprise Architecture.

## Decision

| Concern | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Same as the governance peer |
| API | Node 22 `http` server, plain ESM | Same as the governance peer; no framework needed for this scope |
| Database | SQLite via Node's built-in `node:sqlite` | Zero extra dependencies. Fine for a pilot with a small team. See "Risks" |
| Hosting | Azure App Service, deployed by GitHub Actions | Pattern used by peer apps. Needs platform setup, not yet done |
| Identity | Azure App Service Authentication (Entra ID). The app reads the signed-in user from `X-MS-CLIENT-PRINCIPAL-NAME` | Gives named audit trails without building login. Requests without the header are rejected in production |
| UI components | Plain React and CSS for now. Move to MDS components before go-live | MDS is the approved library, but adopting it is a separate step we can verify once the app runs |

## Consequences

- The importer output in `migration/output/` (git-ignored) seeds the database. Business data never enters the repo.
- The audit trail records the signed-in user on every write, replacing the hard-coded contributor name in the prototype.
- Nothing is deployed yet. Azure resources, the publish profile secret, and Entra app registration need IT or platform owners.

## Risks and open items

- **SQLite on App Service.** A single App Service instance can store the database under `/home`, which persists across restarts. A second instance would get its own copy. Keep the app to one instance until the database moves to a managed service.
- **`node:sqlite` is experimental** in Node 22 and prints a warning. Peer apps accept this; re-check when it stabilises.
- **Platform confirmation.** Confirm with the platform owner that Azure App Service and Entra SSO are the right route for an internal governance app at Maersk.
- **Repo location.** The repo is under a personal account because Maersk-Global rejects new repos from the CLI/API (`mac_id` policy). Move it to the org once allowed.
