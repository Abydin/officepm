# legacy/

This directory is the frozen v1 OfficePM server: Express, better-sqlite3 and a
single-file client (server.js, schema.js, app.js, styles.css, vendor/).
It is kept as the conformance oracle: tests/conformance runs against it by default.
Do not add features here. Bug fixes only if the oracle itself is wrong.
It is deleted once v2 reaches parity and passes the same conformance suite.
