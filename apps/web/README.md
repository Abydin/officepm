# @officepm/web

The OfficePM browser client: React 19, Vite, TypeScript (strict), TanStack Query,
React Router (data mode), Tailwind v4 and shadcn-style components on Radix, lucide
icons. Types and response validation come from `@officepm/shared`; nothing in here
redeclares an API type.

## Run it

From the repo root, with Node 22:

```bash
pnpm install
pnpm dev            # terminal 1: the v2 server on :3000 (demo data: PM_DATA_DIR=.data)
pnpm dev:web        # terminal 2: Vite on :5173, proxying /api to the server
```

Seed demo data once with `PM_DATA_DIR=.data node legacy/scripts/seed-demo.js`, then sign in as
`maya.okafor@officepm.demo` / `demo-password`. If the server runs on another port, start Vite with
`PM_API_URL=http://localhost:3010`.

Vite and Vitest resolve `@officepm/shared` to its source, so they need no build step. Only the type check reads
its built output, so `pnpm typecheck` and `dev:web` build it first; run `pnpm exec tsc -b packages/shared` before a
bare `tsc -p apps/web`.

## Checks

| Command                    | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `pnpm lint`                | ESLint for the whole repo, including the React hooks rules       |
| `pnpm typecheck`           | Server, shared, web and data-compat types                        |
| `pnpm test:unit`           | Every package's Vitest suite, web included                       |
| `pnpm run build:web`       | Production build into `apps/web/dist`                            |
| `pnpm test:e2e`            | Builds server and client, then one Playwright smoke test         |

Playwright needs a browser once: `pnpm --filter @officepm/web exec playwright install chromium`.
The e2e run seeds a throwaway database in the OS temp directory (`e2e/serve.mjs`); it never touches
`pm.db` or `.data`.

## Serving the build

The v2 server serves exactly `index.html`, `app.js`, `styles.css` and `vendor/*` from `PM_WEB_DIR`.
The build is shaped to fit: one JS bundle named `app.js`, one `styles.css`, and hash routes
(`#/overview`), because there is no history-API fallback for deep links. So this works with no server change:

```bash
pnpm run build:web && PM_WEB_DIR=apps/web/dist PM_DATA_DIR=.data node apps/server/dist/main.js
```

The cost is no code splitting. Lifting it needs the server to serve `/assets/*` and fall back to
`index.html`; that is a Phase 4 server change.

## Layout

```
src/
  main.tsx              entry: mounts <App>
  index.css             Tailwind, design tokens (v1's colours), light and dark themes
  app/                  wiring only: router, providers, query client, auth gate, layout shell
  features/<name>/      one folder per product area (auth, overview, projects, events)
    api.ts              query options and mutations for that area
    *-page.tsx          route components
  components/ui/        shadcn-style primitives (button, input, card, sheet ...), no app knowledge
  components/           small shared pieces with app knowledge (avatar, priority mark)
  lib/api/              typed fetch client, the ApiError type, query keys
  lib/                  theme, formatting helpers, cn()
  test/                 Vitest setup and helpers (stubApi, renderApp)
e2e/                    Playwright smoke test and its server launcher
```

### The API client (`src/lib/api`)

`api.get(path, schema)`, `api.post(path, schema, body)` and friends validate every 2xx body against a
shared Zod schema and throw one error type, `ApiError`, with `kind` of `http` (server said no; the
message is the server's own), `network` (no answer) or `invalid-response` (answered, but not what the
contract says). Any 401 clears the session query, which sends the person to `/login`.

### Query keys

Keys live in `src/lib/api/keys.ts` as `qk`, broad to specific (`['tickets']`, then
`['tickets', 'list', { project, board }]`). Invalidate by the broadest key that is still correct. The
server's SSE events are mapped to keys in `features/events/event-keys.ts`; the stream itself is
`useEventStream`, mounted once in the app shell.

## Adding a feature

1. Create `src/features/<name>/`.
2. Put its requests in `api.ts` as `queryOptions(...)` and `useMutation` hooks. Take the response schema from
   `@officepm/shared`; if it is missing there, add it to `packages/shared/src/` first, not here.
3. Add a key to `qk` for each new resource, and, if the server announces changes to it, an entry in `event-keys.ts`.
4. Write the page component, with loading, error and empty states.
5. Add one route in `src/app/router.tsx`, and a sidebar or tab link if people need to reach it.
6. Add a component test using `renderApp` and `stubApi` from `src/test/helpers.tsx`.

## Status (phase 3a)

Built: login, auth gate, app shell (top bar, project sidebar, phone nav sheet, theme), overview
dashboard, project list, project page, and the board frame (header, ticket count, quick-add, view tabs).

Placeholders, labelled in the UI: the Board tab shows live per-status counts instead of draggable columns
(3b), and the Backlog tab (3b) and Epics, Retros and Standup tabs (3c) say which phase builds them. Not
started: ticket drawer, command palette and shortcuts, My Tickets, Docs and Files, Admin. The 3b and 3c
split is a working assumption, not a decision.

There is no "create project" screen because the server has no such endpoint: projects are declared in
`projects.json`. The Projects page says so.
