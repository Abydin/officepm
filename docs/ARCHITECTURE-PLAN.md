OfficePM v2 rewrite: phase plan

Branch: rewrite/v2. Layout: legacy/ (frozen v1), apps/server, apps/web,
packages/shared, tests/conformance. Package manager pnpm 10, Node 22+.

P0 Scaffold and conformance harness. Move v1 into legacy/, turn test/ into
tests/conformance/ driven by OFFICEPM_SERVER_CMD (default legacy/server.js)
and OFFICEPM_SEED_CMD. Monorepo tooling: TypeScript, ESLint, Prettier, CI
(lint, format, typecheck, and the conformance count of 104). No features.
Exit: the 104 existing tests pass through the harness against legacy.

P1 Shared contract and data layer (packages/shared, apps/server/src/db,
tests/data-compat). Zod schemas and the flow capability table, the Drizzle
schema, migrator and upload path resolver, and a suite proving v2 opens
databases v1 created. No HTTP routes.
Exit: data-compat passes against empty, seeded and old-shape databases.

P2 New server (apps/server). The v1 HTTP contract implemented in TypeScript
on Hono, one router per module under apps/server/src/modules. Exit: the
conformance suite passes against the new server via OFFICEPM_SERVER_CMD, the
same 104 tests, and CI runs it.

P3 New web client (apps/web). Rebuild the UI on the shared contract.
Exit: feature parity with the v1 client for the documented flows.

P4 Hardening. Close the gaps recorded in the Phase 2 notes below (rate
limiting, upload streaming, security headers, input validation on the shared
schemas, the v1 quirks), add e2e coverage, and run both servers side by side
to find any remaining behaviour gaps.

P5 Docs, Docker and demo. Package the server and web client in a container,
write the README and ROLLOUT for v2 and the v1 pm.db migration, add the demo
seed. Then cut over: remove legacy/ and move the conformance default to the
v2 server.

Rule throughout: the conformance tests are the contract. They are never
weakened to make a phase pass.

Phase 1 notes: the data layer

Scope. packages/shared (Zod schemas and the flow capability table),
apps/server/src/db (Drizzle schema, migrator, open, path resolver) and
tests/data-compat. No HTTP routes. Versions: drizzle-orm 0.45, drizzle-kit 0.31
(npm latest), zod 4, vitest 5, better-sqlite3 11 and
bcrypt 6 (same majors as legacy).

Migration approach. v2 opens the same pm.db v1 uses. Migration 0000-baseline is
written by hand from legacy/schema.js: the DDL is SCHEMA_SQL verbatim (all IF NOT
EXISTS), followed by the three tickets columns v1 added later, each guarded by
PRAGMA table_info because SQLite has no ADD COLUMN IF NOT EXISTS. The columns are
added by ALTER, not placed in the CREATE, so sqlite_master comes out identical to
a database v1 built itself. drizzle-kit generate is not used for the baseline: its
first migration is a plain CREATE TABLE and would fail on an existing pm.db.
apps/server/src/db/migrate.ts records applied migrations in _officepm_migrations
(the only object v2 adds) and runs each in its own immediate transaction. Every
later migration must be additive (new tables, nullable columns, indexes) and
idempotent, and must not rewrite rows, so v1 still boots on a v2-migrated
database and a rollback stays possible. schema.ts is for query typing only and is
checked against the migrated database by a test.

Compat risks covered by tests/data-compat, each run against an empty database, a
seed-demo database, the old tickets shape (no priority, labels, due_date), a
half-upgraded shape and a database with moved uploads:

1. Existing databases. The baseline applies without error, twice, and the
   resulting schema equals one v1 creates. Rows, bcrypt hashes and ticket key
   counters are unchanged, and v1 itself then boots, logs in and keeps allocating
   keys from the same counter.
2. Old column shape. A database from before the extra tickets columns is upgraded
   in place, including the case where only some of them exist.
3. Upload paths. v1 stores the absolute stored_path. resolveStoredPath re-roots
   the uploads/(projects|tickets)/<id>/<file> tail under the current data
   directory, rejects .. and NUL bytes, never returns anything outside
   <dataDir>/uploads, and the rows are never rewritten.

Phase 2 notes: the server

Scope. apps/server/src: config, projects.json validation, the HTTP app and
twelve modules (auth, users, projects, tickets, comments, attachments, sprints,
retros, github, reports, events, static), each a Hono router with thin
handlers over a service. Versions: hono 4, @hono/node-server 2, bcrypt 6
(hashes stay compatible with v1). Entry point: apps/server/dist/main.js after
`pnpm run build`, which is what OFFICEPM_SERVER_CMD points at. Configuration
uses v1's variable names: PORT, PM_DATA_DIR, PM_PROJECTS_FILE, PM_TOKEN,
ADMIN_EMAIL, ADMIN_PASSWORD, plus PM_WEB_DIR for the client files.

Routes. All 58 registrations of legacy/server.js are ported: 55 under /api and
the three static GETs (/, /app.js, /styles.css), plus the /vendor mount. The
static files come from PM_WEB_DIR, which defaults to legacy/ until P3
replaces the client.

Kept as v1 behaves, on purpose, to be settled in P4: sprints may be created on
kanban and scrumban boards; users come back in three shapes (/api/me and login
use isAdmin, GET /api/users returns the raw is_admin 0/1, POST /api/users
returns is_admin as a boolean); a malformed or oversize JSON body answers 500;
a webhook's raw url is quoted in the system comment even when it is dropped
from the link row; DELETE of a missing sprint, doc, file or link answers 200;
ticket status changes made by the GitHub webhooks bypass the waterfall rule.

Deliberate differences from v1, none covered by the conformance suite:
attachment names keep their UTF-8 characters (v1 mangled them), downloads are
served as application/octet-stream with a private cache header, a stored file
that is missing on disk answers 404 (v1 answered 500), and the webhook token is
compared in constant time.

Known gaps left for P4: multipart bodies are buffered in memory before the
25MB check (v1 streamed and aborted), there is no rate limiting or security
headers, and the request bodies are checked by hand to keep v1's exact
messages rather than by the shared Zod schemas, which the unit tests use to
check every response shape.

Verification. tests/conformance against the new server (104 of 104), the unit
suite, data-compat, lint, format and typecheck.

Phase 3a notes: the web client foundation

Scope. apps/web: login, the auth gate, the app shell (top bar, project sidebar,
a slide-in sheet for the sidebar on phones), the overview dashboard, the project
list and page, and the board frame. Stack: React 19, Vite 8, TypeScript (strict),
TanStack Query 5, React Router 8 in data mode, Tailwind v4, Radix primitives,
cmdk, dnd-kit, lucide icons. Every version is pinned exactly in
apps/web/package.json.

Decisions.

- Hash routing (#/overview). The v2 server serves exactly index.html, app.js,
  styles.css and /vendor/* from PM_WEB_DIR and has no history-API fallback, so a
  deep link to /projects/food would 404. Hash routes need no server change.
- One bundle. The build emits app.js and styles.css as single files (code
  splitting off in vite.config.ts) for the same reason: the static module serves
  those names and nothing under /assets. The cost is a single large script; see the
  bundle-size levers in the P4 list.
- Shared source aliasing. Vite and Vitest resolve @officepm/shared to
  packages/shared/src/index.ts, so a build or a test never reads a stale dist.
  Only the type check reads the built declarations, which is why `typecheck` and
  `dev:web` run `tsc -b packages/shared` first.
- No eslint-plugin-jsx-a11y. The repo is on ESLint 10 and the plugin's latest
  release (6.10.2) declares peer support up to ESLint 9. Accessibility is checked
  by axe in the e2e suite and by role-based queries in the component tests
  instead. The React hooks rules are on.
- Types and response validation come from @officepm/shared: the typed client in
  src/lib/api validates every 2xx body against a shared Zod schema and throws one
  ApiError type (http, network or invalid-response). A schema missing from shared
  is added there first, never declared in the web app.
- Query keys live in one factory (src/lib/api/keys.ts), broad to specific. The
  server's SSE events are mapped to keys in features/events/event-keys.ts, which
  is exhaustive over the shared event list.
- Project creation has no endpoint. Projects and boards are declared in
  projects.json and the server reads it at start, so the Projects page says so
  instead of offering a form.

Phase 3b notes: board, ticket drawer, palette

Scope. The board (columns per status, cards, filters, drag and drop), the ticket
drawer, the command palette and keyboard shortcuts, and My Tickets.

Decisions.

- The drawer is addressed as ?t=KEY on whatever page is showing, so a ticket can
  be linked to and survives a reload while the page behind it stays mounted.
  #/t/KEY is the short form and redirects to the ticket's board. Opening pushes a
  history entry, so Back closes it; opening another ticket replaces rather than
  stacks.
- The assignee picker uses the admin-only GET /api/users list. For everyone else
  the list is the signed-in person plus whoever already appears on the board's
  tickets, and anyone else is added by typing an email. A non-admin users endpoint
  is on the P4 list.
- Activity is comments only. The server keeps no per-ticket history, so the
  drawer's activity is the comment thread (GitHub's included) plus when the ticket
  was created and last changed. Nothing is invented to look like an audit log.
- Delete asks inline ("Delete FOOD-ENG-1? Yes, delete / Keep it") rather than with
  window.confirm or a second dialog. Phase 3c reuses the same pattern for docs and
  files.
- Shortcuts are off while a dialog is open, so typing in the palette or the drawer
  never triggers C, J, K or G. The board's drag works with the mouse, a long press
  on touch, and the keyboard (Space, Left and Right, Space), with moves applied
  optimistically and rolled back with the server's own message if refused.
- dnd-kit's keyboard step is 25px, so board-dnd.ts supplies a column-to-column
  coordinate getter.

Phase 3c notes: the remaining v1 screens

Scope. Backlog (sprints, cycles and phases with planning), Epics, Retros, Standup,
Docs & Files, the Waterfall Phases view and Admin, plus the pieces around them
(a Docs & Files link per project in the sidebar, an Admin link for admins, the
project page's docs list, and v1's sprint picker in the top bar). The
placeholder views are gone. No dependencies were added.

Shared contract. packages/shared gained the request schemas the new forms use
(SprintCreate, SprintPatch, DocCreate, RetroCreate, UserCreate, PasswordReset),
the response lists (DocList, ProjectFileList, RetroList) and ProjectsConfig for
GET /api/admin/projects, which keeps unknown fields of projects.json. Each has a
test in packages/shared/src/phase3c.test.ts. The server was not changed.

Decisions.

- One time-box view. Backlog, Cycles and Phases are one component
  (features/sprints/timebox-view.tsx) because the server models all three as
  sprints; the noun, the kinds offered (cycle and cooldown on Shape Up, phase on
  Waterfall) and the default length come from the shared flow table. Waterfall
  adds a phase-order strip (the board's statuses in sequence, with counts), which
  v1 did not have.
- v1's rules are kept: dates default to today plus the kind's length; activating
  is gated by the board's Definition of Ready (a checklist that is not saved);
  one active sprint per board, with the server's 409 shown inline; completing
  makes the server create the retro, and the "View retro" link appears without a
  reload because sprint.updated now also invalidates retros.
- Moving tickets between sprints is new. v1 only had a free-text sprint id in the
  drawer. A select on each unscheduled row adds it to a planned or active sprint,
  and each ticket inside a sprint can go to another or back to the backlog. It
  uses the existing PATCH of sprint_id.
- Retros are routes: retros is the list and retros/:retroId one retro, so a retro
  can be linked to and the Retros tab stays current on it (only the Board tab
  matches exactly). v1 kept the open retro in component state. Cards can be added
  to any column. v1 has no voting, and neither does the server's data model, so
  there is none here; the server's card edit and delete endpoints are not
  exposed, as in v1.
- Standup is built from the board's tickets as in v1 (done tickets included),
  grouped by assignee with the unassigned last; within a group the newest change
  is first, which v1 did not do.
- Docs & Files lives at projects/:slug/docs. Links and files per v1, and delete
  for both with the inline confirm; v1's UI had no delete although the server does.
  The limits shown are the server's (100 files, 25 MB, and .htm is blocked as well
  as v1's list).
- Admin lives at /admin, with a link only for admins and a guard in the page that
  neither renders nor requests anything for anyone else (the server answers 403
  regardless). Users can be listed, created (with the admin flag) and given a new
  password in a dialog that replaces v1's window.prompt. There is no endpoint to
  change the admin flag of an existing user, so it is set at creation only. The
  boards table is projects.json read only, with the raw JSON behind a disclosure.

Verification. Component tests per view, pure-logic tests for the sprint, epic and
standup rules, an end-to-end spec per view, and axe over every new view in both
themes with zero violations. Four tests were shown to fail with the code
broken (the Definition of Ready gate, the admin guard, the Retros tab matching,
the retros invalidation) and pass once restored.

P4 hardening list (current)

Server.

- Request size. A bodyLimit that streams: body.ts reads the whole text() before
  checking MAX_JSON_BYTES, and uploads.ts reads formData() before checking the
  25 MB limit, so both buffer an oversize body first. Cap while streaming and
  answer 413.
- Malformed JSON answers 400, not the 500 v1 gives (a conformance-visible quirk to
  settle on purpose, not by accident).
- Rate limiting, security headers, validating request bodies with the shared Zod
  schemas while keeping v1's messages, and the other v1 quirks recorded in the
  Phase 2 notes (sprints on kanban boards, three user shapes, DELETE of a missing
  row answering 200, webhook status changes bypassing the waterfall rule).
- A users endpoint that non-admins may call (id, name, email only), so the
  assignee picker can list everyone instead of the signed-in person and the
  board's assignees.
- A project creation endpoint, or a decision to keep projects in projects.json. The
  web client has no create-project screen until that is decided.

Web.

- Bundle size. The single app.js is about 220 kB gzipped. Levers: zod/mini in the
  client, dropping tailwind-merge, and code splitting (needs the server to serve
  /assets/* and fall back to index.html for unknown paths).
- axe in CI. The accessibility spec runs in the e2e suite; wire that suite into
  CI so a violation fails a pull request.
