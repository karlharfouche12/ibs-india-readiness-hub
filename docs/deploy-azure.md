# Deploying to Azure App Service

This is the checklist for the platform owner or IT. The workflow is `.github/workflows/azure-app-service.yml`. It deploys from `main` after a pull request is merged.

## 1. Create the App Service

- Linux, **Node 22 LTS** runtime.
- Turn on **Authentication** (App Service Authentication) with **Microsoft (Entra ID)**. Set unauthenticated requests to **Log in**, so every request is signed in before it reaches the app. The app reads the signed-in user from the `X-MS-CLIENT-PRINCIPAL-NAME` header that App Service sets.

## 2. Application settings

| Setting | Value | Why |
|---|---|---|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | The workflow builds and packages the app. Azure should not rebuild it. |
| `HUB_DB_PATH` | `/home/data/hub.sqlite` | The database must sit outside the deployed folder. Each deploy replaces the deployed files, but `/home` persists. |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~22` (if not already set by the runtime) | `node:sqlite` needs Node 22. |

Do not set `HUB_DEV_USER`. The app ignores it in Azure, but it should not be configured there.

## 3. GitHub repository settings

- **Secret** `AZUREAPPSERVICE_PUBLISHPROFILE`: the publish profile XML from the App Service "Get publish profile" action.
- **Variable** `AZURE_WEBAPP_NAME`: the App Service name.

The first deploy fails until both are set. That is expected.

## 4. Load the data (one time)

The database starts empty. Load the importer output once, using the Kudu console (`https://<app>.scm.azurewebsites.net` → Debug console → SSH):

1. Upload the importer output folder (the one produced by `tools/import-release76.mjs`) to `/home/data/import/`. It contains business data, so use the approved upload route only.
2. From `/home/site/wwwroot`, run:

   ```bash
   node server/seed.mjs /home/data/import --db /home/data/hub.sqlite
   ```

The seed refuses to run if the database already has data, so it cannot be run twice by accident.

## 5. Check it

Open the app URL. You should be signed in automatically. `/api/me` should return your name, and the cockpit should show 18 items.

## Rollback

Redeploy the previous good commit on `main`, or use the App Service deployment history. The database in `/home` is not affected by a code rollback.
