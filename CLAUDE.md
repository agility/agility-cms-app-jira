# Jira Issues — Agility CMS app (Agility Work, provider 1)

Read `README.md` first: what the app does, how the pieces fit, and how to run it with the mock provider.

## Rules

- **Provider-agnostic core.** Nothing outside `lib/providers/<name>` may know which tool it's talking to. A capability
  only one tool has goes behind `capabilities()`, not into the panel as an `if (provider === "jira")`.
- **Never trust identity from the browser.** Every route goes through `withCaller` (`lib/http.ts`), which verifies the
  editor's Agility token with the Management API. Content state and titles are read server-side (`lib/agility/content.ts`).
- **Tokens are sealed and server-only.** Never return a provider token to the client or log one. Store a refreshed token
  before using it (Jira rotates refresh tokens).
- **This repo is public.** No customer names, instance GUIDs or internal URLs in code, tests, commits or PR text.
- **The mock provider verifies nothing.** It must never be reachable in production; `/api/webhooks/jira` 404s unless
  `WORK_PROVIDER=jira`.
- **The UI looks like Jira on purpose** (Atlassian Design System colour tokens in `app/globals.css`), unlike the other
  Agility apps, which are greyscale. Never use an Atlassian or Jira logo: they're trademarks. The icons are our own drawings.
- **Admin authorizes, editors connect.** `/api/setup/*` is admin-only (instance Administrator role or org admin, from
  the Management API). Editors' connections must be to the authorized site (`connectionFor` in `lib/work.ts`).

## Verifying a change

`npm test`, `npm run typecheck`, `npm run build`, then drive it through `/dev-host` with `WORK_PROVIDER=mock`.

## Related

- `agility-cms-app-sdk`: the client half of the iframe protocol. `agility-cms-manager-app-react`
  `src/hooks/iframes/useAppSurfaceMessages.ts` is the real contract.
- `agility-cms-app-marketo`: the app this one's structure follows.
