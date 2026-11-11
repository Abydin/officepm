# frozen-v1

A verbatim copy of the three v1 files the data-compat suite needs, taken from the last commit
that had the full `legacy/` directory (`5b25841`):

| File | Used for |
| --- | --- |
| `schema.js` | The reference schema (what v1's own `migrate()` builds) and the pre-column database shape |
| `scripts/seed-demo.js` | Building a database that v1 itself wrote |
| `server.js` | Booting v1 on a database v2 has migrated (rollback safety), and writing uploads the way v1 did |

The v1 client, its docs and everything else are gone from the tree; `git show 5b25841:legacy/`
has them. These files are not maintained, are not linted or formatted, and must not be edited
to follow v2. The tests in `tests/data-compat/` are the only consumers. Their dependencies
(express, cookie-parser, multer) are devDependencies of `@officepm/data-compat-tests`.

The files are CommonJS, which is why this directory has its own `package.json` (the parent
package is ESM). `server.js` and `seed-demo.js` default their data directory to a path inside
the repository, so the tests always set `PM_DATA_DIR` and `PM_PROJECTS_FILE` explicitly.
