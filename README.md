# Jira Issues for Agility CMS

Link Agility content to Jira issues, create issues from a content item or page with the context filled in, and see each
issue's status, assignee and due date in the editor. In Jira, every linked issue gets a link back to the content, showing
whether it's published.

This is the first provider of **Agility Work**: one provider-agnostic core (`lib/core`) with an adapter per tool.
Linear, Asana and Monday are meant to follow as separate apps on the same core.

> **Status: scaffold (v0.1).** The core, the Jira adapter, the Work panel and dialogs, and a mock provider work end to
> end locally. Not yet decided or built: production storage for connections and links, hosting, the Atlassian app
> registration, Jira webhook registration and its 30-day renewal job, and syncing Agility publish events to Jira.

## Setting it up

1. **Install the app** in Agility (Settings › Apps) and set **Jira site** to your Jira Cloud site, for example
   `acme.atlassian.net`.
2. **An Agility admin authorizes it.** Open any content item, open the Jira panel, and choose **Authorize Jira**. The
   instance is bound to exactly the site you named. If your Atlassian account can't reach it, nothing is saved and you
   see the sites it can reach. Background work (webhooks, keeping links current) runs on this authorization.
3. **Each editor connects their own Atlassian account** from the same panel. It has to be on the authorized site.
   Until an admin has authorized, editors see "ask an Agility admin".

Admin means the instance's Administrator role, or an org admin.

## What editors get

- **Work panel** in the content item and page sidebars: linked issues with key, status, assignee, priority and due date;
  link an existing issue (search, or paste a key or link); create an issue from the content; unlink; refresh.
- **Create from content**: summary and description prefilled, the project's required fields discovered when a project is
  picked, and the new issue already linked.
- **In Jira**: a remote link on each linked issue, titled with the content, showing its state (Staging, Awaiting
  Approval, Published). Published content is shown resolved. Relinking never duplicates: links upsert on a stable id
  (`agility:{guid}:{item|page}:{id}:{locale}`).
- **Per user**: each editor connects their own Atlassian account (OAuth 2.0 3LO), so Jira shows the person, not a bot.
- **Looks like Jira**: status lozenges, issue-type and priority icons, blue keys and initials avatars, so people who live in
  Jira recognise an issue at a glance. No Atlassian logos are used.

## How it fits together

```
Agility Manager App ── iframe ──▶ Work panel (app/content-item-sidebar, app/page-sidebar)
        │  getManagementAPIToken()                     │ fetch, Bearer <editor's Agility token>
        ▼                                               ▼
Management API ◀── users/me, item/page reads ── app API routes (app/api/*) ── lib/work.ts
                                                        │                        │
                                       lib/store (sealed tokens, links)   lib/providers/jira ──▶ Jira Cloud
```

- **Who's calling** (`lib/agility/identity.ts`): the panel sends the editor's own Management API token. The backend asks
  the Management API who it belongs to (`users/me`) and that it can reach the instance. A user id from the browser is
  never trusted.
- **What content** (`lib/agility/content.ts`): the item's or page's state, title and list are read from the Management
  API with that token. The sidebar surface doesn't send workflow state.
- **Tokens** (`lib/store/crypto.ts`): provider tokens are sealed with AES-256-GCM before they reach any store, and never
  go to the browser. Agility's install config is no place for them, because every editor's browser can read it.
- **Jira** (`lib/providers/jira`): REST v3 through `api.atlassian.com/ex/jira/{cloudid}`. Remote links upsert on
  `globalId`. Webhook deliveries are verified (HS256 JWT signed with the client secret) before anything is read.

## Run it locally

```bash
npm install
cp .env.example .env.local
# set WORK_TOKEN_KEY: openssl rand -base64 32
npm run dev            # http://localhost:3071/dev-host
```

`/dev-host` stands in for the Manager App (dev only). With `WORK_PROVIDER=mock` and `WORK_DEV_CALLER=1` the whole app
runs with no Agility instance and no Atlassian site: connect, link, create and unlink against an in-memory tracker.

To use real Jira, register an OAuth 2.0 (3LO) app at developer.atlassian.com with the callback
`${APP_URL}/api/connect/callback` and the scopes `read:jira-work write:jira-work read:jira-user manage:jira-webhook
offline_access`, then set `WORK_PROVIDER=jira`, `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.

## Checks

```bash
npm test           # node:test, no extra dependencies
npm run typecheck
npm run build
```

## Things that bite

- **Jira's rate limit is shared.** A 3LO app gets 65,000 points an hour across every customer's site combined. The panel
  reads link snapshots, not live Jira, and webhooks keep them fresh.
- **Refresh tokens rotate.** Each refresh returns a new refresh token and retires the old one. Store it before using the
  new access token (`sessionFor` in `lib/work.ts`).
- **`/rest/api/3/search` is gone.** Use `/search/jql`.
- **Descriptions must be ADF** (`lib/providers/jira/adf.ts`). A plain string is a 400.
- **The page sidebar's page item** isn't in the SDK's context: call `pageMethods.getPageItem()`.

## Licence

MIT
