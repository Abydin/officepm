# OfficePM

Self-hosted project management for a small office. One Node process, one
SQLite file, no build step on the frontend, no cloud dependency.

Multiple projects, each with its own boards. Each board picks one of five
workflows (Kanban, Scrum, Scrumban, Shape Up, Waterfall) and can optionally
turn on an agile layer (epics/stories, Definition of Done and Ready,
retros, standups, burndown, blockers). GitHub webhooks move tickets
automatically on PR open, deploy and release. Everything else, docs, files,
links, comments, is scoped to a project or a ticket.

## Stack

Exactly five runtime dependencies, on purpose:

- `express` - HTTP server and routing
- `better-sqlite3` - synchronous, in-process SQLite
- `cookie-parser` - session cookie parsing
- `multer` - file upload handling (`2.4.0`, deviating from an earlier
  pinned `1.4.5-lts.1`, see the git history for why)
- `bcrypt` - password hashing

The frontend is Preact + htm, vendored as a single local file
(`vendor/htm-preact.module.js`), loaded directly by the browser as an ES
module. No npm install, no bundler, no CDN script tag.

## Running it

```bash
npm install
cp .env.example .env
# edit .env: set PM_TOKEN at minimum
node --env-file=.env server.js
```

Open `http://localhost:3000`. On first boot with an empty database the
server creates an admin user (`ADMIN_EMAIL`, default
`admin@officepm.local`) and either uses `ADMIN_PASSWORD` from `.env` or
generates a random one and prints it once to the terminal, copy it down
immediately if you didn't set one.

Projects and boards come from `projects.json`, not the database, edit that
file and restart the server to change them. The server refuses to boot on
a malformed `projects.json` or a duplicate board prefix and says exactly
why.

## Files

| Path | What |
|---|---|
| `server.js` | All backend logic: auth, API routes, SQLite schema, GitHub webhooks, SSE |
| `index.html` / `app.js` / `styles.css` | The entire frontend |
| `vendor/htm-preact.module.js` | Vendored Preact + htm runtime |
| `projects.json` | Project and board definitions, source of truth, not the database |
| `pm.db` | SQLite database (gitignored, created on first boot) |
| `uploads/` | Uploaded files, `projects/<slug>/` and `tickets/<key>/` (gitignored) |

## Deploying it

See `ROLLOUT.md` for hosting on an office machine, remote access over
Tailscale with no public internet exposure, wiring up a GitHub Actions
workflow safely, nightly backups, and a plain-language guide for the rest
of the office.

## What this is not

No custom field builder, no workflow automation builder, no Gantt charts,
no multi-tenant SaaS, no mobile app, no SSO, no email notifications, no
per-project permissions (v1 is a small office, everyone logged in sees
every project on purpose). See the PRD's "Out of Scope" section if you
have it, or just ask before assuming something is missing by accident.
