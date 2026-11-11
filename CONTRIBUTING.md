# Contributing

Thanks for looking. OfficePM is small on purpose, so read `PRD.md` section 16 (what
it is not) before proposing a feature, and open an issue first for anything bigger
than a fix. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node 22 or newer and pnpm 10.

```bash
git clone https://github.com/Abydin/officepm.git && cd officepm
pnpm install
pnpm seed          # demo workspace into .data/
pnpm dev           # http://localhost:3000, maya.okafor@officepm.demo / demo-password
pnpm dev:web       # optional, second terminal: Vite on :5173 with live reload
```

`pnpm dev` and `pnpm seed` use `.data/`, which is git-ignored. The other commands
(`pnpm start`, `pnpm backup`, a bare `node apps/server/dist/main.js`) use the
repository root when `PM_DATA_DIR` is unset, which is where a v1 `pm.db` would be, so
set `PM_DATA_DIR` to a throwaway directory whenever you run them by hand.

Playwright needs a browser once: `pnpm --filter @officepm/web exec playwright install chromium`.

## Commands

| Command                                            | What                                                 |
| -------------------------------------------------- | ---------------------------------------------------- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | Static checks. `pnpm format` fixes formatting.       |
| `pnpm test:unit`                                   | Vitest: server, shared package, web components       |
| `pnpm test:conformance`                            | The 104 HTTP tests against the v2 server (builds it) |
| `pnpm test:data-compat`                            | v2 on v1-created databases, and v1 on the result     |
| `pnpm test:e2e`                                    | Browser suite, including axe                         |

## Test expectations

- Every change that alters behaviour comes with a test that fails without it. For a
  fix, write the failing test first and watch it fail.
- `tests/conformance/` is the contract. Do not edit it to make something pass. A
  deliberate difference from v1 is recorded in the phase notes in
  `docs/ARCHITECTURE-PLAN.md` instead.
- The conformance run must report exactly 104 tests and 104 passing; CI checks the count.
- A UI change keeps axe at zero violations in both themes.
- Before opening a pull request, run lint, format:check, typecheck, test:unit,
  test:conformance and test:data-compat; also test:e2e if the client changed.

## Adding a module on the server

A module is a folder in `apps/server/src/modules/<name>/` with a `routes.ts` and a
`service.ts`.

1. Add the schemas for its requests and responses to `packages/shared/src/` (and
   export them from `index.ts`). The shared package is the contract; the server and
   the client both import it.
2. Write `service.ts` as `createXService(ctx)`: the rules and the SQL, throwing
   `HttpError`s (see `http/errors.ts`) with the message the API should return.
   Validate request bodies against the shared schema inside the service.
3. Write `routes.ts` as `xRoutes(ctx)` returning a Hono router: parse, call the
   service, return JSON. Guard routes with `requireAuth(ctx)` or `requireAdmin`
   from `http/auth.ts`. `modules/users/` is the smallest example.
4. Register it in `apps/server/src/app.ts` with `api.route('/', xRoutes(ctx))`.
5. If it needs storage, add a migration to `apps/server/src/db/migrations/`, append
   it to `MIGRATIONS` in `db/migrate.ts`, and mirror the table in `db/schema.ts`.
   Migrations must be additive and idempotent so v1 can still run on the database;
   `tests/data-compat` proves it.
6. Test it: add a `*.test.ts` next to the code (see `app.test.ts`, which checks
   responses against the shared schemas).

## Adding a feature on the web

`apps/web/README.md` has the full recipe. In short: create `src/features/<name>/`,
put its requests in `api.ts` using schemas from `@officepm/shared`, add a key to
`qk` in `src/lib/api/keys.ts` (and to `features/events/event-keys.ts` if the server
announces changes), write the page with loading, error and empty states, add one
route in `src/app/router.tsx`, and add a component test with `renderApp` and
`stubApi`. Add an e2e spec when it is a screen. The Content-Security-Policy forbids
inline scripts, third-party origins and CDN assets.

## Commit style

- A short imperative subject line that says what changed ("Cache the dashboard per
  user for five seconds"), then a body that says why when it is not obvious.
- One logical change per commit. Do not mix a refactor with a fix.
- No em dashes in commit messages, docs or UI strings. Use a comma or a middle dot.
- Do not commit `pm.db`, `uploads/`, `.env` or `.data/`.

## Pull requests

Fill in the template. Describe what you ran and what it reported, not just that
tests pass. Security issues go through [SECURITY.md](SECURITY.md), not a public issue.
