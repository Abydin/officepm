OfficePM v2 rewrite: phase plan

Branch: rewrite/v2. Layout: apps/server, apps/web, packages/shared, tests/conformance,
tests/data-compat (with the frozen v1 files it needs in frozen-v1/). v1 itself (legacy/)
was removed in the cutover below; commit 5b25841 is the last one that contains it. Package manager pnpm 10, Node 22+.

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
to find any remaining behaviour gaps. Done in part: see the Phase 4 notes and
the list that follows them.

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
  bundle-size levers in the P4 list. (Phase 4 split the secondary screens out.)
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

Phase 4 notes: hardening

Scope. Ten items from the hardening list, done in the server (apps/server), the shared
contract (packages/shared) and the build and CI of the client. The conformance suite
was not touched: it passes 104 of 104 against both servers, unchanged.

What changed.

- Request size. http/limits.ts replaces the read-then-check in body.ts and uploads.ts.
  A declared Content-Length over the cap is refused with 413 before the body is read;
  whatever is declared, the body is also counted as it streams and errors the instant it
  passes the cap, so a missing (chunked) or lying Content-Length cannot make the server
  hold more than the cap. Hono's own bodyLimit was not used because it trusts a
  Content-Length that is under the cap and buffers the chunked case. Caps: 2 MB for
  everything, 25 MB plus 256 KB of multipart overhead on POST .../files. A file between
  25 MB and the request cap still gets v1's 400 "file exceeds 25MB limit".
  Limit: the multipart form is still parsed in memory, so an upload can hold up to about
  25.25 MB at once. Streaming it to disk needs a streaming multipart parser (a new
  dependency) and was left out.
- Malformed JSON is a 400 ("request body is not valid JSON"), and a body that is JSON
  but not an object or array is a 400 ("request body must be a JSON object"). v1 answered
  500 for both. No conformance test covers either.
- Login throttle (http/throttle.ts). Failures are counted in a 15 minute window, each key
  in its own map of 10,000 entries so a flood of one kind cannot crowd out the others:
  the full client address (30; an IPv6 address keeps all eight groups, and a link-local
  one its zone id), the IPv6 /64 (150, a separate aggregate, so two addresses in one /64
  do not share the strict budget but a client rotating through the /64 is still capped),
  the (address, email) pair (8), and the email alone (100, the global ceiling). IPv4-mapped
  IPv6 is IPv4. A block is answered 429 with Retry-After, before any bcrypt work. Only
  failures count, so normal use is never blocked.
  The email limit is keyed on the pair, so a stranger failing a named account's login
  exhausts only its own pair and cannot lock the account out for everyone. The global
  ceiling holds a client that already has a failure of its own on that email; a client
  with none is admitted at a reduced rate (one new address per slowdownMs, 2 s), derived
  from the email's last failure so it needs no extra state. A clean client is therefore
  slowed during a flood, not stopped.
  The auth service looks the user up first (synchronous) and tells the throttle whether the
  email has an account. An unknown email counts against the address only and never creates
  pair or email entries, so a flood of made-up emails cannot fill those maps; it still costs
  the decoy compare and the per-address failure.
  Full maps. Expired entries are swept first (at most once a second). If the address map is
  still full, a NEW address is refused (fail closed) and tracked addresses are unaffected.
  If the /64, pair or email map is full, only that new key goes untracked: the client is
  still bounded by its own address limit, so a flood of one type cannot refuse the others.
  The attempt is counted in the same synchronous step as the check, before the bcrypt compare
  is awaited, and refunded when the password is right (which also clears that pair's
  failures), so a parallel burst cannot all pass the check. If the compare throws, the
  attempt stays counted. State is in memory and resets on restart. The address is the
  socket's; behind a proxy set PM_TRUST_PROXY=1 to use the right-most X-Forwarded-For
  entry (the one the proxy itself appended).
  Remaining limits, stated plainly. This in-memory throttle is good against casual and
  single-source guessing. It is not a defence against a determined distributed attacker;
  that needs an edge rate limiter or a shared store in front of the app.
  (a) An account that does not exist never earns a pair block, so repeated 401 against one
  email versus a 429 after eight attempts tells a patient attacker whether the account
  exists. The decoy compare hides timing, not this.
  (b) Past the global per-email ceiling, new addresses share one slowdown slot (one per
  slowdownMs, 2 s) that an attacker's failures can occupy, so clean clients can be slowed
  during a flood. A legitimate user who has mistyped once is held until it ages out.
  (c) Many IPv6 addresses can fill the address map, and the cap is not sized per /64. A
  full address map refuses new addresses (fail closed).
  (d) When the pair or email map is full, a client is tracked only by its address limit
  (30, not 8), which is looser than the pair limit.
  Also: the distributed guesser is slowed, not stopped (8 guesses per address per 15
  minutes, 100 per email before the slowdown starts); the thresholds (30, 150, 8, 100, 2 s)
  are untuned guesses, not measured against real use; and behind a reverse proxy without
  PM_TRUST_PROXY every client shares one address and the per-address limit becomes a global
  one. The compare was already async bcrypt; a test pins that the event loop keeps turning
  while it runs. Non-string credentials are a 400.
- Upload extension blocklist (modules/attachments/uploads.ts). It is narrow: .exe, .sh,
  .bat, .cmd, .js, .html and .htm. .svg, .mjs and .php are not blocked. The real defence
  is not the list: every download is served as an attachment (never inline), with
  X-Content-Type-Options nosniff and the CSP, so an uploaded file is not rendered or
  executed by the browser.
- Event streams are closed when their user's password is reset, and when their session
  logs out (EventBus.closeForUser and closeForSession). Not done: closing a stream when
  its session merely expires, which is checked only when the stream opens.
- Security headers (http/security-headers.ts) on every response, errors and static
  files included: a Content-Security-Policy, X-Content-Type-Options nosniff, X-Frame-Options
  DENY, Referrer-Policy no-referrer, Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy
  same-origin, a Permissions-Policy that turns off camera, microphone, geolocation and payment,
  Strict-Transport-Security only when X-Forwarded-Proto is https, and Cache-Control
  no-store on /api responses that set none. The CSP is script-src 'self' plus the SHA-256 of
  each inline script in the served index.html (the client has one, the theme bootstrap),
  computed at startup, so the policy follows the file it ships with and never needs
  'unsafe-inline' for scripts. style-src keeps 'unsafe-inline' because React, Radix and
  dnd-kit set style attributes at runtime. Everything else is same-origin, objects and
  base URIs are off and frame-ancestors is none. The e2e suite checks it with the real
  built client: no CSP violation across sign-in, the lazy screens and the event stream,
  the inline script runs through its hash, and another origin cannot frame the app.
- Body validation. packages/shared/src/requests.ts holds a request schema for every
  POST and PATCH body (tickets, DoD, comments, links, docs, sprints, retros and cards,
  users, board settings, the three webhooks), and the services call it AFTER their own
  v1 checks. So every v1 message is unchanged (they still win for missing fields, bad
  types of ticket, status, priority, labels, due_date and sprint kind), and the schemas
  only speak for cases v1 turned into a 500 or stored as garbage (POST /login keeps its own
  hand-written typeof check rather than LoginInputSchema, for the same reason): a wrong-typed value is
  a 400 naming the field ("invalid description: ..."). The schemas are looser than the
  form schemas on purpose (a truthy blocked flag, empty-string dates and null for "not
  set" stay valid). Deliberately stricter than v1: sprint dates must be real YYYY-MM-DD
  (or empty), and a sprint status must be planned, active or completed.
- Webhooks use the same transition rule as a manual move (tickets/transitions.ts, one
  function both call). On a waterfall board a hook that would skip a phase does not move
  the ticket; it still records the GitHub link, adds a system comment saying "Not moved: ..."
  and lists the ticket under a new optional "skipped" field of the response (matched now
  means moved). Nothing changes on the other four flows, which have no transition rule.
  The seed's Acme board is the only waterfall board with has_github.
- Backup. There was no backup route or script, only a tar command in the README and
  ROLLOUT.md, which can tear pm.db in WAL mode. `pnpm run backup [dir]` (backup-main.ts)
  takes the database with SQLite's online backup API (safe while the server writes),
  checks the copy with PRAGMA integrity_check, then writes pm-backup-DATE.tar.gz holding
  pm.db, projects.json and uploads/, the same layout as before. ROLLOUT.md and README.md
  now show it. Restoring is still extracting the archive into an empty data directory.
- pnpm audit found two moderate advisories, both in dev tooling: esbuild 0.18 under
  drizzle-kit's esbuild-kit loader (a dev-server issue) and minimatch under ESLint. Both are
  fixed with pnpm.overrides: esbuild 0.25.12 (published 2025-11-01) and minimatch 11.0.4
  (published 9 days before this change; 11.0.5 and later were under 7 days old). pnpm audit
  reports none now.
- CI. The browser suite (e2e, including axe) already ran as its own job; it now keeps its
  report on failure, and a ci-required job needs it and every other job, so branch
  protection can require one name. Marking it required is a repository setting this code
  cannot make. An audit job runs pnpm audit but is left out of ci-required, so a new
  advisory flags itself without blocking an unrelated pull request.
- Bundle. packages/shared is marked sideEffects false, so the bundler can drop what the client
  does not import (worth 0.3 kB). The server now serves /assets/* (hashed files, immutable, same traversal guard as
  /vendor, and a malformed percent escape is a 404 instead of the 500 it was), which made
  code splitting possible: the Backlog, Epics, Retros, Standup, Docs and Admin screens load
  on first visit through the router's lazy option. Gzipped before: app.js 222.0 kB.
  After: app.js 204.6 kB plus a 12.3 kB shared chunk the browser preloads, so the first
  load is 216.9 kB (about 2 percent less) and the six screens are about 12 kB loaded on demand.
  The gain is small because almost all of the weight is react-dom, react-router, zod and
  TanStack Query, which every screen needs. Two components had to change: a navigation test
  now waits for the lazy route to commit, and an e2e selector for the Retros tab is exact,
  because it used to pass only by finishing before the screen's own link rendered.
  Skipped: zod/mini (every shared schema is written against the classic API and the
  server uses the same package, so it is a rewrite of the contract, not a cheap lever) and
  dropping tailwind-merge (about 12 kB gzipped, but it resolves class conflicts when a
  component's className overrides a default, and nothing here would catch a visual
  regression from losing that).

Deviations from v1, all intended: 413 for an oversize body (v1: 500), 400 for malformed
JSON (v1: 500), 429 on repeated failed logins, 400 for wrong-typed fields (v1: 500 or garbage
stored), stricter sprint dates and status, a skipped webhook move on waterfall boards,
no-store on API responses, and the new headers.

Verification. Every new behaviour has a test in apps/server/src/hardening.test.ts,
backup.test.ts or apps/web/e2e/security.spec.ts, and each was shown to fail with the code
it covers broken and pass once restored (31 deliberate breakages of the server code, and 2 in the browser suite: dropping the
CSP script hash and dropping the framing protection). Two of the first runs exposed weak
tests, which were fixed: the integrity-check test of the backup, and a framing test that
passed with framing allowed because the frame never loaded.

P4 hardening list (current)

Server.

- Rate limiting on routes other than login. Login is throttled; nothing else is, which is
  fine for a tailnet-only office tool and worth revisiting if it is ever exposed.
- Login throttle tuning. The thresholds are untuned, a distributed guesser is only slowed,
  and an unknown email never earns a pair block (see the Phase 4 notes). Tune against real
  traffic, and put an edge limiter or shared store in front for a distributed attacker.
- The v1 quirks still kept on purpose: sprints on kanban and scrumban boards, three
  shapes of user, DELETE of a missing sprint, doc, file or link answering 200, and a
  webhook's raw url quoted in the system comment.
- Streaming uploads to disk, so a 25 MB upload is not held in memory while it is parsed.
- Closing an event stream when its session expires, not only on reset and logout.
- A users endpoint that non-admins may call (id, name, email only), so the
  assignee picker can list everyone instead of the signed-in person and the
  board's assignees.
- A project creation endpoint, or a decision to keep projects in projects.json. The
  web client has no create-project screen until that is decided.

Web.

- Bundle size. 217 kB gzipped on first load. What is left is react-dom, react-router, zod
  and TanStack Query; zod/mini and dropping tailwind-merge are the remaining levers,
  each with the cost recorded above.

Phase 5 notes: docs, Docker and demo

Scope. A demo seeder for v2, a container image, and the documents an outside
contributor or evaluator needs to clone, run and understand the project. Nothing in
tests/conformance or legacy/ was changed, and the conformance default stays on legacy.

Demo seeder (apps/server/src/seed, seed-main.ts). `pnpm seed` writes the same
workspace as legacy/scripts/seed-demo.js (30 tickets across the seven boards, 6 users,
four sprints, a retro, checklists, links, docs, a GitHub link) through the v2 migrator,
so the schema is v2's own. The content lives in seed/demo-data.ts, copied from the v1
script. Safety: PM_DATA_DIR must be set (otherwise the data directory would default to
the repository root, where a v1 pm.db lives); a database that has tickets is refused
always, since the key counters would collide; a data directory that already has users is
refused unless --allow-non-empty is given. It writes only to PM_DATA_DIR. Proof: a unit
test seeds a temp directory, signs in over the app and reads the tickets back, and
compares the result with the v1 script's output on boards, users, counters, tickets,
sprints, comments, checklists, links, docs, retro, GitHub rows and schema (ids and
dates differ by design, so those are compared as present or absent); the comparison
fails if one ticket title is changed. The conformance seed test also passes against
the new seeder through OFFICEPM_SEED_CMD, and the e2e launcher now uses it. The
data-compat suite still builds its seeded fixture with the v1 script, on purpose: its
point is a database v1 itself made.

Scripts. `pnpm build` now builds the server and the client (it used to build only the
server, so `pnpm install && pnpm build && pnpm start` served the v1 client). The old
behaviour is `pnpm build:server`, which conformance:v2 and CI use. `pnpm start` defaults
PM_WEB_DIR to apps/web/dist; `pnpm dev` builds everything and runs on .data. The raw
default of PM_WEB_DIR in config.ts is still legacy/, because the v2 conformance run
depends on a client being there and removing legacy/ is a separate decision.

Health route. GET /api/health (no session, reads the database, 500 if it cannot) was
added for the container healthcheck. It is outside the v1 contract; no conformance test
covers it, and hardening/health tests do.

Docker. Multi-stage Dockerfile on node:24-bookworm-slim pinned to the index digest
(multi-platform, resolved with docker buildx imagetools inspect). Node 24 is viable but
better-sqlite3 11.10 has no Node 24 prebuilt binary, so it compiles from source in the
build stages (python3, make and g++ are installed there only, not in the runtime image);
bcrypt uses a prebuilt binary. The cost is a slower build, not a failure. Three stages
feed the runtime: production dependencies of the server only, the compiled server and
shared package, and the built client. Runs as the node user, read-only root filesystem,
all capabilities dropped, a node-based healthcheck on /api/health, PM_DATA_DIR=/data
as a volume, and PM_WEB_DIR pointing at the built client. docker-compose.yml publishes
on 127.0.0.1 by default and names the volume officepm-data so the backup and migration
recipes do not depend on the project directory. Built and run locally on Docker
20.10.17 (linux/arm64): health 200, the built client served, admin and demo login,
a file upload, data surviving down and up, backup and restore through the recipes in
ROLLOUT.md, and a v1 database mounted into the volume. Not run: linux/amd64 (only the
digest is multi-platform, the build itself was arm64), and a Linux bind mount owned by
another uid. CI gained a `docker` job that builds the image without pushing it and
boots it (health, client, login); it uses only the already pinned checkout action and is
part of ci-required.

Docs. README.md rewritten for v2 with refreshed screenshots (taken from the running v2
app with a one-off Playwright script against a seeded temporary server, 1440x900),
CONTRIBUTING.md, CODE_OF_CONDUCT.md (Contributor Covenant 2.1, fetched from the
upstream repository, contact set to the maintainer's address, excluded from Prettier so it
stays verbatim), SECURITY.md, issue and pull request templates, docs/MIGRATING-FROM-V1.md
and an updated ROLLOUT.md. The unreferenced v1 images (docs/board-scrolled.png and
docs/before/) have been deleted.

Cutover notes: legacy/ removed

Done after Phase 5 (the two items that used to head "What remains before merge").
Commit 5b25841 is the last commit that contains legacy/ (server, client, schema, seed
script and its README); `git show 5b25841:legacy/<file>` or a worktree at that commit
brings v1 back.

- Conformance. `tests/conformance/helpers.js` now defaults to the compiled v2 server
  (apps/server/dist/main.js) and the v2 seeder (apps/server/dist/seed-main.js), and takes
  better-sqlite3 from apps/server. `pnpm test:conformance` builds the server first, so it
  works from a clean checkout. `test:conformance:v2` is gone. CI has one `conformance` job
  (Node 22 and 24) that asserts exactly 104 tests and 104 passing; the old v1 job and the
  `conformance-v2` job were merged into it, and `ci-required` lists the remaining jobs.
  The 104 tests themselves are unchanged.
- Client directory. The raw default of PM_WEB_DIR is now apps/web/dist, so it matches
  `pnpm start` and the image. The conformance suite never requests the client, so it does
  not need the web build.
- Data-compat. These tests genuinely need v1: they build databases with v1's own schema
  code and seed script, and boot the v1 server on the migrated result (rollback safety, and
  uploads written by v1). The choice was between keeping a minimal frozen copy and
  reducing the suite to what v2 can verify alone. Reducing it would drop exactly the
  claims that matter most: "v1 still runs after v2 touched it" needs a live v1 server, and
  a database v1 itself wrote (with uploads) is only fresh if v1's own code makes it. A
  recorded .db file could stand in for the second, never for the first.
  So three files were moved unchanged into tests/data-compat/frozen-v1/ (server.js,
  schema.js, scripts/seed-demo.js, byte for byte, git records them as renames), and
  express, cookie-parser and multer became devDependencies of the data-compat package
  (same locked versions as before). Nothing else of v1 was kept: not the client, vendor
  directory or its README. Coverage lost: none of the data-compat assertions changed. What
  it costs: about 1,900 lines of unmaintained v1 JavaScript stay in the tree as a fixture,
  excluded from lint and format, plus three test-only dependencies. The v2 seeder
  comparison test and the schema baseline test now read the same frozen copies.
- Wiring. The `legacy` entry is gone from pnpm-workspace.yaml, the ESLint and Prettier
  ignores point at frozen-v1 instead, and the Dockerfile no longer copies legacy/package.json.
  README, CONTRIBUTING, SECURITY, the PR template, .env.example and
  docs/MIGRATING-FROM-V1.md were updated. The older phase notes above still describe legacy/
  as it was at the time and are left as the historical record.

What remains before merge.

- CI first ran on GitHub on 2026-11-11 (branch rewrite/v2). Passed: conformance (104 on
  Node 22 and 24, against both servers), unit and data-compat, lint and typecheck, web,
  the docker image build (including the amd64 source build of better-sqlite3) and audit.
  web-e2e failed three times before any test ran, at `playwright install --with-deps`,
  on both ubuntu-latest (26.04) and ubuntu-24.04, because apt on the runner could not
  resolve the Ubuntu mirrors (runner apt DNS, not the image). The step now installs only
  the browser, without `--with-deps`, so apt never runs. With that change (commit
  800ed38) every job passed, including web-e2e (58 tests with the axe checks) and the
  `ci-required` aggregate. If a later runner image lacks a system library for Chromium,
  the fallback is the pinned official Playwright container image. What remains is to
  mark `ci-required` as a required check in the repository settings (a setting code
  cannot make).
- Update the portfolio card (and the repository description) for v2.
- Merge strategy against the open pull request #1 (feat/demo-seed, "Demo seed data and a
  redesigned UI"): it carries v1 work that rewrite/v2 supersedes. Decide whether to close
  it, or to land the rewrite as the default branch and cherry-pick anything still wanted.
  Squash or keep the phase history is the other half of that decision.
- Confirm the contact address used in SECURITY.md and CODE_OF_CONDUCT.md, and whether
  GitHub private vulnerability reporting is enabled (SECURITY.md does not claim it is).

Post-merge features: sidebar scope and handoff
(Added on rewrite/v2 after the first green CI run. Same rule as before: the 104
conformance tests are untouched and API changes are additive.)

Sidebar scope. The sidebar (apps/web/src/app/layout/sidebar-nav.tsx) is decided by the
route alone, with `useMatch('/projects/:slug/*')`, the same match the top bar's project
picker uses. Under it (the project page, a board and its views, Docs & Files, and
`#/t/KEY`, which redirects to a board) it shows that project's boards and Docs & Files
and an All projects link to `/projects`. On Overview, My Tickets, Projects and Admin it
shows the full grouped list as before. A ticket drawer opened over My Tickets does not
change the sidebar, because the route did not change. The nav keeps its label
"Projects and boards", so the e2e selectors that used it still resolve.

Handoff. A status change made in the UI is no longer a bare `PATCH`. The board's moves
(drag, touch, keyboard drag, Alt+arrows) and the ticket's Status field open a dialog
(apps/web/src/features/handoffs) and apply nothing until it is confirmed, so cancelling
a drag needs no rollback. The only paths that change a status from the UI are those two;
there is no separate "mark done" action, and moving to a done status is the same move.
The default target is the dropped-on column (or the picked status) when the workflow allows
it, else the next status; a drop on an earlier column opens on Reject.

- Rules in `@officepm/shared` (`handoff.ts`): `transitionViolation` (moved there from
  `modules/tickets/transitions.ts`, which re-exports it, so PATCH and the GitHub webhooks
  still call the one rule), `handoffOptions` (what the dialog offers) and `planHandoff`
  (what the server accepts). Approve goes to a later status, reject to an earlier one and
  needs a reason; both go through `transitionViolation`.
- Server (`modules/handoffs`): `POST /api/tickets/:key/handoff` validates everything first,
  then writes the status, the assignee, the comment (`source: "handoff"`, written through the
  comments module's new `record`) and a `ticket_handoffs` row in one transaction, and only then
  broadcasts `ticket.updated`, `comment.created` and `handoff.created`. Who may use it is who may
  PATCH a ticket: any signed-in user, because v1 has no per-ticket permissions and this adds none.
- Attachments reuse `POST /api/tickets/:key/files` unchanged (25 MB, 20 per ticket, blocklist,
  uuid names). The client uploads first and the handoff names the ids, which must belong to that
  ticket; a refused handoff has the files it uploaded deleted again. They stay ticket files: v1's
  file table has no comment link, and the comment lists them by name.
- Nudge. `ticket_handoffs` holds the recipient (assignee email, or department when no person was
  named) and `handoff_reads` the per-person read mark, so a department handoff is unread for each
  member until that member opens it. `GET /api/handoffs/unread` and
  `POST /api/tickets/:key/handoffs/read` serve the My Tickets list and the sidebar and top bar
  counts; opening a ticket reads it. The `handoff.created` event carries no note or reason (the
  stream reaches everyone) and only makes clients refetch their own list.
- Departments. Users had none, so `users.department` (nullable TEXT) was added, with
  `GET /api/people` for the pickers (the user list stays admin-only, which the conformance suite
  pins) and `PATCH /api/users/:id/department` for admins.
- Migration `0001-handoffs` is additive: the nullable column and two new tables, nothing rewritten.
  tests/data-compat compared a migrated database with v1's schema exactly; it now sets aside what
  is declared in `V2_ADDITIONS` (tests/data-compat/support/legacy.ts) and still compares everything
  else, still boots v1 on the result and still checks no row changed. A later migration declares
  what it adds there too.
- The dark theme's `--accent-ink` went from white to a dark ink: white on the dark accent blue is
  about 3:1, which axe flagged on the dialog's primary button. Light theme unchanged.
