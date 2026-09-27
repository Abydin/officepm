# OfficePM · Application PRD

**Product:** OfficePM
**Version:** 1.0 (consolidated)
**Status:** Approved for build
**Owner:** Engineering
**Last Updated:** 2026-01-21

---

## 1. Overview

**OfficePM** is a lightweight, self-hosted project management tool for internal office use. It replaces paid tools like ClickUp, Jira, and Trello with a single Node.js process, one SQLite file, and a small on-prem deployment.

It supports:

- **Multiple projects**, each with its own boards and team members
- **Multiple boards per project**, each with its own workflow
- **Five workflow flows**: Kanban, Scrum, Scrumban, Shape Up, Waterfall
- **An opt-in Agile layer** on top of any flow (epics, stories, DoD, retros, standups, burndown)
- **GitHub CI/CD integration** per board for engineering work
- **Docs, links, notes, and file uploads** scoped to projects and tickets
- **Remote access** via Tailscale, no public internet exposure

**One-line pitch:** One Node process. One SQLite file. Every team. Every flow. On-prem.

---

## 2. Problem Statement

The office currently uses a mix of spreadsheets, Trello boards, and manual status updates to track work. Engineering progress in GitHub is not reflected on any board without someone updating it by hand. Paid tools like ClickUp cost money per seat and are far more complex than the team needs.

**We need:**
- One tool for every team (Engineering, Design, Sales, Marketing, Social, Ops, QA, Product)
- Automatic GitHub to board sync for engineering work
- Multiple projects (Northwind, Food, Acme, etc.) in one instance
- Multiple workflows (some teams sprint, some flow, some run cycles)
- On-prem hosting with no cloud dependency for ticket data
- Fast enough to feel native on the office LAN
- Remote access for hybrid work without exposing ports

**We don't need:**
- Custom field builders
- Workflow automation builders
- Gantt charts, resource leveling, capacity planning
- Multi-tenant SaaS
- Mobile apps
- SSO (in v1)
- Notifications (email, Slack)

---

## 3. Goals & Success Criteria

| Goal | Metric |
|---|---|
| Replace manual tracking | Every team uses OfficePM for their board |
| Auto-sync GitHub to status | Zero manual status changes for code-driven work |
| Support every team | >= 5 boards across >= 2 projects in active use |
| Fast enough to feel instant | First load < 200ms on LAN, ticket move < 5ms perceived |
| Simple to maintain | Full source readable in < 45 minutes |
| On-prem, no cloud data | All data on the office server only |
| Remote access | Remote users reach all projects via Tailscale |
| Zero recurring cost | Tailscale free tier, on-prem hardware |

---

## 4. Users & Roles

No per-project permissions in v1. Everyone logged in sees every project. This is intentional for a small office.

| Role | Typical Use |
|---|---|
| **Admin** | Manages users and boards |
| **PM** | Owns backlog, priorities, releases |
| **Dev** | Backend and frontend engineering |
| **QA** | Verifies work on staging |
| **Designer** | Design work |
| **Sales** | Pipeline management |
| **Marketer** | Campaigns |
| **Social** | Content scheduling |
| **Ops** | Support, onboarding, incidents |
| **Content Writer** | Docs, web copy |

A person can belong to multiple teams. There is no `team` field on the user, teams are inferred from the boards they use.

---

## 5. Concepts & Hierarchy

```
OfficePM
|-- Project (e.g., Food)
|   |-- Board (e.g., Engineering)
|   |   |-- Ticket (e.g., FOOD-ENG-104)
|   |   |   |-- Comment
|   |   |   |-- Link
|   |   |   |-- File
|   |   |   `-- GitHub event
|   |   `-- ...
|   |-- Project Doc
|   |-- Project File
|   `-- Sprint / Cycle / Retro
`-- Project (e.g., Northwind)
```

**Four levels:** Project to Board to Ticket to Comment/File/Link.

**Key rules:**
- Every ticket belongs to exactly one board.
- Every board belongs to exactly one project.
- Board prefixes must be globally unique (e.g., `FOOD-ENG`, `FOOD-DES`).
- Ticket keys are `<PREFIX>-<NUMBER>` (e.g., `FOOD-ENG-104`).
- Boards come from `projects.json`. Tickets, comments, files, docs, sprints, retros come from `pm.db`.

---

## 6. Features

### 6.1 Authentication

- Email + password login
- bcrypt password hashing
- Session cookie (`httpOnly`, `sameSite=lax`), 7-day expiry
- Admin creates users
- No self-signup, no SSO in v1

### 6.2 Projects

- Multiple projects supported
- Defined in `projects.json`, loaded at startup
- Each project has: slug, name, description, list of boards
- No UI for project creation in v1, edit the JSON, restart

### 6.3 Boards

- Multiple boards per project
- Each board has: slug, name, prefix, icon, flow, statuses, types, and flow-specific options
- Board prefix is globally unique (validated on startup)
- Tickets per board share the board's prefix

### 6.4 Tickets

| Field | Notes |
|---|---|
| Key | Auto-generated, `<PREFIX>-<N>` |
| Title | Required |
| Type | From board's `types` |
| Status | From board's `statuses` |
| Assignee | Optional |
| Parent key | Optional, for subtasks |
| Level | `epic` / `story` / `task` / `bug` (if Agile on) |
| Description | Optional |
| Acceptance criteria | JSON array (if Agile on) |
| Points | Optional (if board has `points: true`) |
| Appetite | Optional (if board has Shape Up) |
| Sprint ID | Optional (if board has sprints) |
| Blocked | Flag + reason (if Agile on) |
| Created at | Auto |

### 6.5 Comments

- Any user can comment
- System comments for GitHub events
- Comment shows author + timestamp + body

### 6.6 Docs & Files

- **Project docs** · links and notes attached to a project
- **Project files** · uploaded files stored in `uploads/projects/<slug>/`
- **Ticket links** · URLs attached to a ticket
- **Ticket files** · uploaded files stored in `uploads/tickets/<key>/`

File rules:
- Max 25 MB per file
- Max 20 files per ticket
- Max 100 files per project
- Blocked extensions: `.exe`, `.sh`, `.bat`, `.cmd`, `.js`, `.html`, `.htm`
- Downloads require session auth; served with `Content-Disposition: attachment`

### 6.7 GitHub Integration

Three webhook endpoints for GitHub Actions:

| Endpoint | Trigger | Effect |
|---|---|---|
| `POST /api/github/pr-opened` | PR opened | Move ticket to Code Review, post comment |
| `POST /api/github/deploy` | Deploy to staging/production | Move ticket, post comment |
| `POST /api/github/release` | Release tag | Bulk-update all tickets in changelog |

- Auth: shared secret in `x-pm-token` header
- Only fires on boards with `has_github: true`
- Ticket ID extracted from branch name / commit message via regex `[A-Z]+-\d+`

### 6.8 Workflows (Flows)

Five flows, declared per board:

| Flow | Sprints? | WIP limits? | Points? | Cycles? | Phases? |
|---|---|---|---|---|---|
| **Kanban** | No | Yes | No | No | No |
| **Scrum** | Yes | No | Yes | No | No |
| **Scrumban** | Yes | Yes | Optional | No | No |
| **Shape Up** | No | No | No | Yes | No |
| **Waterfall** | No | No | No | No | Yes |

The UI adapts based on the board's flow.

### 6.9 Agile Layer (Opt-In Per Board)

Turned on with `agile: true` or a detailed config. Adds:

- **Work hierarchy:** Epic to Story to Task/Bug
- **User story format:** As a / I want / So that
- **Acceptance criteria:** Checklist on stories
- **Definition of Done:** Board-level checklist on every ticket
- **Definition of Ready:** Board-level checklist on sprint entry
- **Retrospectives:** Per-sprint retro board with three columns
- **Standup view:** Auto-generated from ticket activity
- **Burndown chart:** Inline SVG per sprint
- **Blockers:** Flag + reason on tickets

Agile is orthogonal to flow. Any flow can have Agile on.

### 6.10 Sprints, Cycles, Retros

- **Sprint** · Scrum/Scrumban, one active at a time, 14-day default
- **Cycle** · Shape Up, 6-week cycle + 2-week cooldown
- **Retro** · Auto-created when a sprint completes

### 6.11 Dashboard

A single overview page showing ticket counts per project and per board:

```
Project              Open   In Progress   Done (7d)
Food                  42        11           18
Northwind                23         8           12
```

No charts, no filters, no drill-down.

### 6.12 Admin

- Create user (email, name, password)
- List users
- Reset user password
- Read `projects.json` (read-only view)

No UI for editing `projects.json` in v1.

---

## 7. Technical Architecture

### 7.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js 20 + Express | Fast to build, minimal deps |
| Database | SQLite via `better-sqlite3` | Synchronous, in-process, microsecond reads |
| Frontend | Preact + htm (3 KB) | React-like, no build step |
| Styling | Plain CSS, local file | No CDN, no Tailwind JIT delay |
| Real-time | Server-Sent Events (SSE) | Instant updates, no polling |
| Files | Local disk under `uploads/` | Simple, one backup command |
| Auth | Session cookie | Simple, no JWT |
| Hosting | One Node process on office PC | On-prem |
| Remote access | Tailscale | No port forwarding, encrypted |

### 7.2 Dependencies

```json
{
  "dependencies": {
    "express": "^4.19.0",
    "better-sqlite3": "^11.0.0",
    "cookie-parser": "^1.4.6",
    "multer": "^1.4.5-lts.1",
    "bcrypt": "^5.1.1"
  }
}
```

Five dependencies. All server-side. Nothing shipped to the browser except the app's own code.

### 7.3 Files

```
pm-tool/
|-- server.js              <- all backend logic
|-- index.html             <- shell
|-- app.js                 <- Preact + htm, all views
|-- styles.css             <- one CSS file
|-- projects.json          <- project + board definitions
|-- uploads/               <- file storage
|   |-- projects/<slug>/
|   `-- tickets/<key>/
|-- pm.db                  <- SQLite
`-- package.json
```

### 7.4 Performance Targets

| Metric | Target |
|---|---|
| First load (LAN) | < 200ms |
| First load (Tailscale) | < 500ms |
| Subsequent loads | < 50ms (cached) |
| Board render (500 tickets) | < 30ms |
| Ticket move (perceived) | < 5ms |
| SSE broadcast | < 20ms |
| SQLite read | < 1ms |
| API response (local) | < 10ms |
| Total first-load payload | < 50 KB gzipped |

---

## 8. Data Model

### 8.1 Core Tables

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,                -- bcrypt hash
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  key TEXT UNIQUE NOT NULL,              -- e.g. FOOD-ENG-104
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  qa_owner TEXT,
  parent_key TEXT,
  level TEXT,                            -- epic | story | task | bug
  description TEXT,
  acceptance_criteria TEXT,              -- JSON array
  points INTEGER,
  appetite TEXT,
  sprint_id TEXT,
  blocked INTEGER DEFAULT 0,
  blocker_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT DEFAULT 'user',            -- user | system
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE github_links (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- pr | commit | deploy | release
  repo TEXT NOT NULL,
  ref TEXT NOT NULL,
  url TEXT,
  actor TEXT,
  environment TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 8.2 Docs & Files

```sql
CREATE TABLE project_docs (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- link | note
  url TEXT,
  body TEXT,
  author TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE project_files (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ticket_links (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ticket_files (
  id TEXT PRIMARY KEY,
  ticket_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 8.3 Sprints, Cycles, Retros

```sql
CREATE TABLE sprints (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- sprint | cycle | cooldown | phase
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT 'planned',         -- planned | active | completed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE retros (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  sprint_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'open',            -- open | locked
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE retro_cards (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL,
  column TEXT NOT NULL,                  -- well | didnt | actions
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  ticket_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 8.4 Board Settings & DoD

```sql
CREATE TABLE board_settings (
  project_slug TEXT NOT NULL,
  board_slug TEXT NOT NULL,
  flow TEXT DEFAULT 'kanban',
  agile_enabled INTEGER DEFAULT 0,
  wip_limits TEXT,                       -- JSON
  definition_of_done TEXT,               -- JSON array
  definition_of_ready TEXT,              -- JSON array
  PRIMARY KEY (project_slug, board_slug)
);

CREATE TABLE ticket_dod (
  ticket_key TEXT NOT NULL,
  item TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  PRIMARY KEY (ticket_key, item)
);
```

### 8.5 Board Definitions

Boards are **not** stored in the DB. They come from `projects.json`. Restarting the server picks up changes.

---

## 9. API Surface

### Auth
```
POST   /api/login
POST   /api/logout
GET    /api/me
```

### Projects & Boards
```
GET    /api/projects
GET    /api/projects/:slug
GET    /api/projects/:slug/boards/:board
GET    /api/projects/:slug/boards/:board/settings
PATCH  /api/projects/:slug/boards/:board/settings
```

### Tickets
```
GET    /api/tickets?project=&board=
POST   /api/tickets
GET    /api/tickets/:key
PATCH  /api/tickets/:key
DELETE /api/tickets/:key
```

### Comments
```
GET    /api/tickets/:key/comments
POST   /api/tickets/:key/comments
```

### Sprints
```
GET    /api/projects/:slug/boards/:board/sprints
POST   /api/projects/:slug/boards/:board/sprints
PATCH  /api/sprints/:id
DELETE /api/sprints/:id
```

### Docs, Files, Links
```
GET    /api/projects/:slug/docs
POST   /api/projects/:slug/docs
DELETE /api/projects/:slug/docs/:id

GET    /api/projects/:slug/files
POST   /api/projects/:slug/files
GET    /api/projects/:slug/files/:id
DELETE /api/projects/:slug/files/:id

GET    /api/tickets/:key/links
POST   /api/tickets/:key/links
DELETE /api/tickets/:key/links/:id

GET    /api/tickets/:key/files
POST   /api/tickets/:key/files
GET    /api/tickets/:key/files/:id
DELETE /api/tickets/:key/files/:id
```

### Retros
```
GET    /api/projects/:slug/boards/:board/retros
POST   /api/projects/:slug/boards/:board/retros
GET    /api/retros/:id
POST   /api/retros/:id/cards
PATCH  /api/retros/:id/cards/:cardId
DELETE /api/retros/:id/cards/:cardId
```

### GitHub (service token)
```
POST   /api/github/pr-opened
POST   /api/github/deploy
POST   /api/github/release
```

### Dashboard
```
GET    /api/overview
```

### Real-time
```
GET    /api/events                     (SSE stream)
```

### Admin
```
GET    /api/users
POST   /api/users
PATCH  /api/users/:id/password
GET    /api/admin/projects
```

---

## 10. UI Design

### 10.1 Design Principles

- **Speed over polish** · every action < 200ms
- **Density with clarity** · compact rows, generous section spacing
- **Zero training** · new hire understands the board in 5 minutes
- **Keyboard-first** · every action has a shortcut
- **GitHub-native feel** · status dots, monospace keys, avatars
- **One screen, one job**

### 10.2 Visual Language

**Colors:** dark/light theme, with status-colored accents (gray, blue, purple, amber, cyan, green, red).

**Typography:** Inter for UI, JetBrains Mono for keys and SHAs. 14px base.

**Spacing:** 4/8/12/16/24/32/48/64, base unit 8px.

**Radius:** 4/6/8/12px.

**Icons:** Lucide, inline SVG, 16px default.

**Fonts:** System fonts (`-apple-system`, `Segoe UI`, Inter fallback). Zero downloads.

### 10.3 Shell

```
+--------------------------------------------------------------+
|  Logo   Project [v]   Sprint [v]   search  bell  avatar      |
+----------+---------------------------------------------------+
|          |                                                   |
|  Sidebar |              MAIN CONTENT                         |
|          |                                                   |
+----------+---------------------------------------------------+
```

### 10.4 Screens

| Screen | Purpose |
|---|---|
| Login | Email + password |
| Overview | Counts per project and board |
| Project Overview | Project's boards and docs |
| Board | Kanban (or Scrum/Shape Up/Waterfall) |
| Backlog | Sprint backlog (Scrum/Scrumban) |
| Epics | Epic list with progress bars |
| Retros | Retro board list and detail |
| Standup | Auto-generated daily view |
| Ticket Drawer | Full ticket detail |
| Docs & Files | Project docs, files, links |
| Admin | Users, boards (read-only) |
| Command Palette (`Cmd+K`) | Search + actions |

### 10.5 Ticket Drawer

Slides in from the right, 520px wide. Contains:
- Header: key, level, type
- Fields: status, assignee, QA owner, sprint, points, epic
- User story (if story)
- Acceptance criteria
- Definition of Done
- Subtasks
- Blockers
- GitHub panel (if board has `has_github`)
- Links
- Attachments
- Comments

### 10.6 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` / `Ctrl+K` | Command palette |
| `C` | Create ticket |
| `G B` | Go to Board |
| `G S` | Go to Sprints |
| `G R` | Go to Reports |
| `J` / `K` | Next / previous ticket |
| `Enter` | Open selected |
| `E` | Edit |
| `A` | Assign to me |
| `/` | Search |
| `?` | Show shortcuts |
| `Esc` | Close drawer |

### 10.7 Responsive

| Breakpoint | Layout |
|---|---|
| >=1440px | Sidebar + board + drawer side by side |
| 1024 to 1439px | Drawer overlays |
| 768 to 1023px | Board scrolls horizontally |
| <768px | List view only |

Office desktops are the primary target.

### 10.8 Accessibility

- All actions keyboard-reachable
- Focus rings always visible
- Color contrast >= 4.5:1
- Status never conveyed by color alone
- Dark and light themes tested

---

## 11. Hosting & Access

### 11.1 On-Prem Deployment

- One always-on office PC or VM (e.g., `192.168.1.50`)
- Node.js 20+
- Runs via `systemd` for auto-restart
- Backups: nightly `tar czf` of `pm.db`, `projects.json`, `uploads/`

### 11.2 Remote Access

**Tailscale** installed on the server and each user's device:

- Users open `http://pm-office:3000` or `https://pm-office.tailnet.ts.net`
- No port forwarding, no public IP, no certs to manage
- Encrypted end-to-end
- Optional HTTPS via `tailscale serve`

Alternatives considered: Cloudflare Tunnel (10-min setup, public URL, requires Cloudflare account) and port forwarding (rejected, too risky).

### 11.3 GitHub Actions

- **Self-hosted runner** on the office network reaches the API directly
- OR **Tailscale on GitHub-hosted runner** reaches the API via tailnet
- Repository secret: `PM_TOKEN` (shared secret)

### 11.4 Backup

One command:

```bash
tar czf pm-backup-$(date +%F).tar.gz pm.db projects.json uploads/
```

Retain 30 days locally. Weekly copy to office NAS.

---

## 12. Security

- bcrypt password hashing (10 rounds)
- Session cookie: `httpOnly`, `sameSite=lax`, `secure` when behind HTTPS
- Session expiry: 7 days, cleaned hourly
- Service token for GitHub endpoints (`x-pm-token` header)
- File downloads require session auth, served as `attachment` (never inline)
- Blocked file extensions: `.exe`, `.sh`, `.bat`, `.cmd`, `.js`, `.html`, `.htm`
- Path traversal prevented, filenames are UUIDs on disk
- No public internet exposure, Tailscale only
- No secrets in source, env vars for `PM_TOKEN`, `JWT_SECRET` (if used)

---

## 13. Migration & Versioning

### From v1.2 to v1.3
```sql
CREATE TABLE sprints (...);
CREATE TABLE board_settings (...);
ALTER TABLE tickets ADD COLUMN sprint_id TEXT;
ALTER TABLE tickets ADD COLUMN points INTEGER;
ALTER TABLE tickets ADD COLUMN appetite TEXT;
```

### From v1.3 to v1.4
```sql
ALTER TABLE tickets ADD COLUMN level TEXT;
ALTER TABLE tickets ADD COLUMN acceptance_criteria TEXT;
ALTER TABLE tickets ADD COLUMN blocked INTEGER DEFAULT 0;
ALTER TABLE tickets ADD COLUMN blocker_reason TEXT;
ALTER TABLE board_settings ADD COLUMN definition_of_done TEXT;
ALTER TABLE board_settings ADD COLUMN definition_of_ready TEXT;
ALTER TABLE board_settings ADD COLUMN agile_enabled INTEGER DEFAULT 0;
CREATE TABLE ticket_dod (...);
CREATE TABLE retros (...);
CREATE TABLE retro_cards (...);
```

Existing boards default to `flow: "kanban"` and `agile_enabled: 0`. Nothing breaks.

### From v1.4 to v1.5 (files)
```sql
CREATE TABLE project_docs (...);
CREATE TABLE project_files (...);
CREATE TABLE ticket_links (...);
CREATE TABLE ticket_files (...);
```

Idempotent on startup. No manual migration needed.

---

## 14. Timeline

| Week | Deliverable |
|---|---|
| 1 | Auth, users, login page, project/board scaffolding |
| 2 | Ticket CRUD, Kanban board, comments |
| 3 | GitHub webhook endpoints, Actions templates |
| 4 | Multi-project support, project switcher, overview |
| 5 | Docs, files, links |
| 6 | Sprints, cycles, retros |
| 7 | Agile layer (epics, stories, DoD, standups, burndown) |
| 8 | Flow-specific UI (Scrum, Scrumban, Shape Up, Waterfall) |
| 9 | SSE real-time, optimistic UI, command palette |
| 10 | Tailscale setup, self-hosted runner, backups |
| 11 | Rollout to first project (Food) |
| 12 | Rollout to remaining teams |

**Total: 12 weeks to full rollout.**

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Team doesn't adopt it | Roll out one team at a time; keep it dead simple |
| GitHub Actions can't reach server | Self-hosted runner or Tailscale on runner |
| SQLite corruption | Nightly backup; WAL mode; single-writer pattern |
| File storage fills disk | Per-file and per-project limits; monitor at 80% |
| Too many projects = clutter | Sidebar collapses non-active projects |
| Duplicate board prefixes | Startup validation refuses to run |
| `projects.json` edited wrong | Validate on startup; clear error message; refuse to start |
| Password leaks | bcrypt, no plaintext logging |
| Server goes down | systemd auto-restart; always-on machine |
| Tailscale goes down | LAN access still works |
| Performance degrades at scale | SQLite fine to ~100k tickets; upgrade path to Postgres exists |

---

## 16. Out of Scope (Explicitly)

- Custom field builders
- Workflow automation builders
- Gantt charts, resource leveling, capacity planning
- Multi-tenant SaaS
- Mobile apps
- SSO / OAuth / SAML
- Email notifications
- Slack / Teams integration
- Rich text editor
- File previews (PDFs open in new tab, images download)
- Version history of files
- Drag-and-drop file upload
- Global search across projects
- Per-project permissions
- Project creation UI (JSON only)
- Board creation UI (JSON only)
- Story point estimation poker
- Program-level (SAFe) views
- Release train management

Add these only when a real team complains about a real problem. Not before.

---

## 17. Open Questions

1. Should a board be able to switch flows mid-project? (Default: yes, edit JSON, restart.)
2. Should sprint completion force unfinished tickets to a specific status? (Default: no, user chooses.)
3. Should velocity be shown on Scrumban boards? (Default: yes.)
4. Should Waterfall phases allow parallel work? (Default: no, sequential only.)
5. Should docs/files be visible across projects? (Default: no, scoped per project.)
6. Should there be a global "My Tickets" view across all projects? (Default: yes, one SQL query.)

**Defaults accepted unless objected.**

---

## 18. Approval

| Role | Name | Date |
|---|---|---|
| Product Owner | | |
| Engineering Lead | | |
| Design Lead | | |
| Sales Lead | | |
| Marketing Lead | | |
| QA Lead | | |

---

**End of OfficePM Application PRD v1.0.**

---

### What this document covers

This is the single consolidated PRD for the entire OfficePM application, from v1.0 through all the versions we discussed. It replaces the separate v1.0, v1.1, v1.2, v1.3, and v1.4 documents.

Everything in here is intentional:
- **Multiple projects** so Northwind, Food, Acme can coexist
- **Multiple boards per project** so each team gets its own space
- **Five flows** so Scrum, Kanban, Scrumban, Shape Up, and Waterfall teams all fit
- **Opt-in Agile layer** so teams that want epics/stories/retros get them, and teams that don't aren't bothered
- **GitHub integration** so engineering status updates itself
- **Docs and files** so every project has its materials in one place
- **Simple fast stack** so it feels instant on the office LAN
- **On-prem + Tailscale** so it works from anywhere without exposing ports
