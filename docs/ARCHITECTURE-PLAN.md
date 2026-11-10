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
