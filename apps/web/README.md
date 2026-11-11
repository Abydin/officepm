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

Seed demo data once with `pnpm seed` (it writes to `.data`), then sign in as
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
| `pnpm test:e2e`            | Builds server and client, then the Playwright suite (a spec per view, plus axe) |

Playwright needs a browser once: `pnpm --filter @officepm/web exec playwright install chromium`.
The e2e run seeds a throwaway database in the OS temp directory (`e2e/serve.mjs`); it never touches
`pm.db` or `.data`.

## Serving the build

The v2 server serves `index.html`, `app.js`, `styles.css`, `vendor/*` and `assets/*` from `PM_WEB_DIR`. The build is
shaped to fit: an entry named `app.js`, one `styles.css`, the lazily loaded screens (Backlog, Epics, Retros, Standup,
Docs, Admin) as hashed files under `assets/` (served immutable), and hash routes (`#/overview`), because there is no
history-API fallback for deep links. No server change is needed:

```bash
pnpm run build:web && PM_WEB_DIR=apps/web/dist PM_DATA_DIR=.data node apps/server/dist/main.js
```

Size, gzipped: 222.0 kB of JavaScript in one file before Phase 4; now 204.6 kB of entry plus a 12.3 kB shared chunk
the browser preloads (216.9 kB on first load), with the six screens, about 12 kB, fetched on first visit. The rest is
react-dom, react-router, zod and TanStack Query, which every screen needs.

## Security headers

The server sends a Content-Security-Policy with every response: scripts only from the page's own origin plus the
SHA-256 of `index.html`'s one inline script (the theme bootstrap), styles from the origin and inline (React, Radix
and dnd-kit set style attributes), no framing, no objects, and connections only to the same origin. So the client
must not add an inline script, load a font, image or script from a CDN, or call another origin; `e2e/security.spec.ts`
fails on any CSP violation. Changing the inline script in `index.html` is fine: the server hashes whatever file it serves.

## Layout

```
src/
  main.tsx              entry: mounts <App>
  index.css             Tailwind, design tokens (v1's colours), light and dark themes
  app/                  wiring only: router, providers, query client, auth gate, layout shell
  features/<name>/      one folder per product area (auth, overview, projects, tickets, sprints, retros,
                        epics, standup, docs, admin, palette, shortcuts, events)
    api.ts              query options and mutations for that area
    *-page.tsx          route components
  components/ui/        shadcn-style primitives (button, input, card, sheet ...), no app knowledge
  components/           small shared pieces with app knowledge (avatar, priority mark)
  lib/api/              typed fetch client, the ApiError type, query keys
  lib/                  theme, formatting helpers, cn()
  test/                 Vitest setup and helpers (stubApi, renderApp)
e2e/                    Playwright specs (one per view, axe, security headers) and the server launcher
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

## Status (phase 4)

Built in 3b, on top of 3a (login, auth gate, app shell, overview, project list and page, board frame):

- **Board**: one column per status in the board's flow, ticket cards (key, title, priority, assignee, labels,
  points, due, blocked and overdue flags), filters by assignee, label and text (kept in the URL as `?a=`, `?l=`,
  `?q=`), live updates from the event stream. Drag with the mouse, a long press on touch, or the keyboard:
  Space to pick a card up, Left and Right to choose a column, Space to drop (Enter opens the ticket instead, and
  Alt+Left/Right nudges a card one column). Moves are optimistic: if the server refuses (a Waterfall board will
  not skip a phase) the card goes back and the server's message shows in an alert. dnd-kit's own keyboard step
  is 25px, so `board-dnd.ts` supplies a column-to-column coordinate getter.
- **Ticket drawer**: `?t=KEY` on any page (the short link `#/t/KEY` redirects to the ticket's board). Edits title,
  description, status, priority, due date, assignee and QA owner (searchable pickers), sprint, points, appetite,
  level, parent ticket, labels, blocked flag and reason, acceptance criteria and the definition of done; comments,
  links (add and remove), attachments (upload and download), the GitHub panel on boards that have it, and delete
  with a confirm step. The server keeps no per-ticket history, so "activity" is the comment thread (including
  GitHub's) plus when the ticket was created and last moved.
- **Command palette** (Ctrl/Cmd+K or `/`): jump to a page, project or board, find a ticket by key or title
  (searched on the server, capped at 8), create a ticket (pick a board, type a title), switch theme, open the
  shortcut list. Shortcuts: `C`, `?`, `G` then `B`/`S`/`R`, `J`/`K`, `Enter`, `E`, `A`.
- **My Tickets**.

Added in 3c (the remaining v1 screens, none of them placeholders now):

- **Backlog, Cycles, Phases** (`#/projects/:slug/boards/:board/backlog`): one view for every flow that has time-boxes,
  named after the flow. Create a sprint, cycle, cooldown or phase (dates start from today plus the kind's default
  length); activate one through the board's Definition of Ready checklist (one active per board, the server's refusal
  is shown); mark one completed, which makes the server create its retro and shows a link to it; burndown for active and
  completed ones; velocity on Scrumban. Tickets move between sprints with a select on each row, and back to the
  backlog (new: v1 only had a sprint id field in the drawer). Waterfall also shows its phase order with counts.
- **Epics**: each epic with its done count and progress, and its tickets; each opens in the drawer.
- **Retros** (`.../retros`, `.../retros/:retroId`): the list, and one retro with its three columns and a box to add a card to each.
  v1 has no voting and no card edit or delete in its UI, so there are none here.
- **Standup**: tickets grouped by person with status, blockers and when each last changed.
- **Docs & Files** (`#/projects/:slug/docs`): links and files, with the server's limits shown. Delete (with an inline confirm) is new.
  The project page lists the same links read only.
- **Admin** (`#/admin`, admins only): users, create a user (with the admin flag), reset a password in a dialog, and the
  boards from projects.json read only. The admin flag of an existing user cannot be changed: the server has no endpoint.
- **Handoff dialog** (`features/handoffs/`): every status change from the UI goes through it, not through `PATCH`: the board
  (mouse, touch, keyboard drag, Alt+arrows) and the Status field in the ticket. Nothing is applied optimistically, so a
  cancelled drag leaves the card where it was. The rules (next and previous status, what a Waterfall board allows, the
  reason on reject) are `planHandoff` and `handoffOptions` in `@officepm/shared`, the same functions the server runs.
  Attachments are uploaded to the ticket first and removed again if the handoff is then refused. Recipients see a count
  in the sidebar and top bar and a Handed to you list on My Tickets. Admins edit a person's department on the Admin page.
- The top bar's sprint picker (v1's), a Docs & Files link under each project in the sidebar and an Admin link for admins. The sidebar is scoped by route: under `/projects/:slug` it shows that one project and an All projects link (`sidebar-nav.tsx`), elsewhere it lists every project.

Phase 4 changed the build, not the screens: the secondary screens load lazily, the e2e suite gained a security spec
(the CSP in a real browser), and CI now runs the whole e2e suite, axe included, in a job that a required `ci-required`
check depends on.

Rough edges, neither of which v1 had either: the command palette has no entries for Docs & Files or Admin (the sidebar has them), and
the top bar's sprint picker, like v1's, only opens the backlog; it does not scroll to the chosen sprint.

Assignee pickers: the server's user list is admin-only, so for everyone else the list is the signed-in person
plus whoever already appears on the board's tickets; anyone else is added by typing their email.

There is no "create project" screen because the server has no such endpoint: projects are declared in
`projects.json`. The Projects page says so.

## Accessibility

`e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1 A and AA rules) over the board, the drawer, the palette, the open
assignee picker, the shortcut list, My Tickets, and every 3c view (backlog with its Definition of Ready gate open, cycles,
phases, velocity, epics, retros, one retro, standup, the project page, docs and files, admin with the reset dialog open),
in both themes, and expects zero violations. Automated rules
find a fraction of real problems: the keyboard drag and the screen-reader announcements were exercised by hand
and by test, not by an assistive technology.
