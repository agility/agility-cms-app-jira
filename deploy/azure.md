# Azure hosting

Everything lives in resource group **`agility.apps.jira`** (Main Accelerator Core subscription, North Central US).

| Resource | Name | Notes |
|---|---|---|
| App Service plan | `asp-agility-apps-jira` | Linux, **Free (F1)**: about 60 CPU-minutes a day, no Always On (cold starts), no custom-domain SSL. Move up with `az appservice plan update -n asp-agility-apps-jira -g agility.apps.jira --sku B1` |
| Web app | `agility-apps-jira` | Node 22, `node server.js` (Next standalone), HTTPS only, FTPS off. https://agility-apps-jira.azurewebsites.net |
| Storage account | `agilityappsjira` | Table Storage for setups, connections, sealed tokens and links. **Shared-key access is off**: only Entra identities with a data role get in |
| Key Vault | `agility-apps-jira-kv` | RBAC mode. Holds `WORK-TOKEN-KEY`, the AES-256-GCM key that seals provider tokens |
| Managed identity | `id-agility-apps-jira-deploy` | GitHub Actions deploy, via OIDC. Federated credential `github-main` trusts only `repo:agility/agility-cms-app-jira:ref:refs/heads/main` |

## Who can do what

- **The web app's own identity:** Storage Table Data Contributor on the storage account; Key Vault Secrets User on the vault.
- **The deploy identity:** Website Contributor on the web app only.

## App settings

`WORK_PROVIDER` (`mock` until the Atlassian app is registered, then `jira`), `APP_URL`, `AZURE_TABLE_ACCOUNT`,
`WORK_TOKEN_KEY` (a Key Vault reference, never the value), `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `PORT`/`WEBSITES_PORT=8080`.
Switching to real Jira adds `ATLASSIAN_CLIENT_ID`, plus `ATLASSIAN_CLIENT_SECRET` as a second Key Vault reference.

## Deploying

Push to `main` (or run the "Deploy to Azure" workflow by hand). The workflow tests, builds the standalone server,
zips it with `public/` and `.next/static`, deploys with `azure/webapps-deploy`, and checks the manifest answers.
GitHub repository variables: `AZURE_CLIENT_ID` (the deploy identity), `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.

## Never

- Turn shared-key access back on, or put a storage connection string in app settings.
- Put `WORK_TOKEN_KEY` in app settings as a value. Rotating it makes every stored token unreadable: everyone reconnects.
- Set `WORK_DEV_CALLER` in Azure.
