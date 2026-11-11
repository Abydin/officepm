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
