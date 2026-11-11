OfficePM v2 rewrite: phase plan

Branch: rewrite/v2. Layout: legacy/ (frozen v1), apps/server, apps/web,
packages/shared, tests/conformance. Package manager pnpm 10, Node 22+.

P0 Scaffold and conformance harness. Move v1 into legacy/, turn test/ into
tests/conformance/ driven by OFFICEPM_SERVER_CMD (default legacy/server.js)
and OFFICEPM_SEED_CMD. Monorepo tooling: TypeScript, ESLint, Prettier, CI
(lint, format, typecheck, and the conformance count of 104). No features.
Exit: the 104 existing tests pass through the harness against legacy.

P1 New server (apps/server). Same HTTP contract as v1, implemented in
TypeScript. Exit: the conformance suite passes against the new server via
OFFICEPM_SERVER_CMD, with the same 104 tests.

P2 Shared contract (packages/shared). Types and validation for the API shared
by server and web, so the contract lives in one place.

P3 New web client (apps/web). Rebuild the UI on the shared contract.
Exit: feature parity with the v1 client for the documented flows.

P4 Parity and hardening. Close any behaviour gaps found by running both
servers side by side, add e2e coverage, packaging and Docker.

P5 Cutover. Remove legacy/, move the conformance default to the v2 server,
update README and ROLLOUT, document the data migration from v1 pm.db.

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
