# OfficePM Rollout Guide

Print this, or keep it open in a tab. Part 1 is for whoever sets up and
maintains the server. Part 2 is for everyone else, and is short on purpose.

---

## Part 1 · Hosting, access and backups (for the admin)

### 1.1 What you need

- One always-on machine on the office network (a spare PC, an old Mac
  Mini, a small VM). Call it the office PC.
- Node.js 20 or newer installed on it.
- Tailscale installed on that machine and on every device that needs
  remote access.

### 1.2 First install

```bash
# on the office PC, inside the officepm folder
npm install
cp .env.example .env
# edit .env: you MUST set PM_TOKEN to a long random string (sessions are
# stored in SQLite, not signed cookies, so there's no separate session
# secret to set). ADMIN_EMAIL / ADMIN_PASSWORD are optional, for the first
# login only. If you leave ADMIN_PASSWORD unset, the server prints a
# random one to the terminal the
# first time it boots, once, then never again - copy it down immediately.
node --env-file=.env server.js
```

Open `http://localhost:3000` on the office PC to confirm it's up, log in
with the admin account, then use Admin > Create user to add everyone else.
There is no self-signup by design (PRD 6.1) - the admin creates every
account.

### 1.3 Keep it running: systemd

Create `/etc/systemd/system/officepm.service` (adjust the paths and the
user that owns the officepm folder):

```ini
[Unit]
Description=OfficePM
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/office/officepm
ExecStart=/usr/bin/node --env-file=/home/office/officepm/.env server.js
Restart=on-failure
RestartSec=3
User=office

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now officepm
sudo systemctl status officepm
```

If the office PC is a Mac, use a `launchd` plist with
`KeepAlive: true` instead - same idea, auto-restart on crash or reboot.

### 1.4 Remote access via Tailscale (no public internet exposure)

1. Install Tailscale on the office PC and sign in to the office's
   Tailscale network (tailnet).
2. Install Tailscale on every teammate's laptop/phone and sign in to the
   same tailnet.
3. Everyone opens `http://<office-pc-tailscale-name>:3000` - no port
   forwarding, no public IP, no certificate to manage.
4. Optional: run `tailscale serve https / http://localhost:3000` on the
   office PC to get a `https://pm-office.<tailnet>.ts.net` address with a
   managed certificate. If you do this, OfficePM's session cookie already
   handles it correctly (`trust proxy` is set to trust the loopback
   connection Tailscale forwards to, and the cookie's `secure` flag follows
   `X-Forwarded-Proto`).
5. If Tailscale is ever down, the office LAN still works as a fallback -
   that's why `http://<lan-ip>:3000` should also be written down somewhere.

Port forwarding was explicitly rejected in the PRD (11.2) as too risky -
don't do it even temporarily.

### 1.5 GitHub Actions integration

Pick one:

- **Self-hosted runner on the office network.** It can reach
  `http://localhost:3000` or the office PC's LAN address directly. No
  Tailscale needed on the runner.
- **Tailscale on a GitHub-hosted runner.** Add the `tailscale/github-action`
  step to your workflow, join the office tailnet, then the runner can hit
  `http://<office-pc-tailscale-name>:3000`.

Either way, add a repository secret named `PM_TOKEN` with the same value
as the server's `.env` `PM_TOKEN`. Example workflow step for a PR event:

```yaml
- name: Notify OfficePM
  run: |
    curl -sf -X POST http://pm-office:3000/api/github/pr-opened \
      -H "x-pm-token: ${{ secrets.PM_TOKEN }}" \
      -H "Content-Type: application/json" \
      -d "{\"repo\":\"${{ github.repository }}\",\"branch\":\"${{ github.head_ref }}\",\"title\":\"${{ github.event.pull_request.title }}\",\"url\":\"${{ github.event.pull_request.html_url }}\",\"actor\":\"${{ github.actor }}\"}"
```

Do the same shape for `deploy` (send `environment: staging|production`)
and `release` (send `tag` and `changelog`) on the matching workflow
triggers. A webhook only moves a ticket if its board has `has_github: true`
in `projects.json` - Design, Marketing and Support boards in the seed data
are deliberately not wired up, and will just return
`{"ok": true, "matched": []}`.

### 1.6 Backups

Nightly, from cron or systemd timer:

```bash
cd /home/office/officepm
tar czf /home/office/backups/pm-backup-$(date +%F).tar.gz pm.db projects.json uploads/
```

Retain 30 days locally, and copy the weekly Sunday backup to the office
NAS. A minimal cron entry:

```
0 2 * * * cd /home/office/officepm && tar czf /home/office/backups/pm-backup-$(date +\%F).tar.gz pm.db projects.json uploads/ && find /home/office/backups -mtime +30 -delete
```

SQLite runs in WAL mode already (set at startup), which is the main
mitigation against corruption from a hard crash mid-write; the nightly
backup is the mitigation against everything else.

### 1.7 Adding or changing a project or board

There is no UI for this by design (PRD 6.2/6.3/16). Edit `projects.json`
directly, then restart the service:

```bash
sudo systemctl restart officepm
```

`systemctl restart` stops the old process first, then starts the new one -
so if the edit was bad, the board goes down, not stays on the old config.
The server refuses to start on a malformed `projects.json` or a duplicate
board prefix and exits immediately with a clear error, which systemd's
`Restart=on-failure` will retry every few seconds forever, crash-looping,
until the file is fixed. Read the actual error with:

```bash
journalctl -u officepm -n 20 --no-pager
```

then fix `projects.json` and restart again. Always check
`systemctl status officepm` after any `projects.json` edit.

---

## Part 2 · How to use your board (for everyone else)

### Logging in

Go to the OfficePM link your admin gave you (starts with `http://` or
`https://`, works over Tailscale from home too). Log in with the email and
password the admin created for you. If you forget your password, ask an
admin to reset it - there's no "forgot password" email flow in v1.

### Finding your board

Your team's board is listed in the left sidebar under its project. Click
it. The columns you see depend on how your board is set up:

- **Kanban** boards (most design, marketing, support work): Backlog, In
  Progress, Review, Done - move a card through as you work it.
- **Scrum** boards (most engineering work): tickets live in Sprint
  Backlog, then move right as they're built, reviewed and QA'd.
- **Scrumban** boards: like Kanban but with a work-in-progress limit per
  column - if a column shows "5/3" in red, that column is over its limit
  and needs attention before pulling in more.
- **Shape Up** boards: Bet, Building, Cooldown, Shipped - each "pitch" has
  an appetite (how many weeks it's worth spending).
- **Waterfall** boards: Requirements, Design, Implementation, Testing,
  Deployed, in that order.

You don't need to know which one your board uses - just use the columns
you see. That's the whole idea.

### Working a ticket

Click any card to open its details on the right. You can change status,
assignee, description, add a comment, attach a file, or drop in a link.
Everything saves automatically when you click away from a field or press
Enter.

### Sprints, cycles and phases (Scrum, Shape Up, Waterfall boards)

Open Backlog from the sidebar (or `G` then `S`) to see your board's
sprints, cycles or phases. Create one with a name and dates, then
Activate it, if the board has a Definition of Ready, you will be asked to
check off each item first. Once it's done, click Mark Completed, a retro
is created for it automatically and a View Retro button appears right
there. Active and completed sprints with dates show a burndown chart.
Scrumban boards also show a velocity panel once at least one cycle is
completed. The topbar's Sprint dropdown is a shortcut back to Backlog
from anywhere on that board.

Waterfall boards will not let you skip a phase, moving a ticket from
Requirements straight to Testing is rejected, you have to go through
Design and Implementation first (moving backward to fix a mistake is
always allowed). This is on purpose, PRD 17.4, no parallel work on
Waterfall.

### If your board is connected to GitHub

Opening a pull request whose branch name or title contains the ticket key
(like `FOOD-ENG-104`) automatically moves that ticket to Code Review and
leaves a comment with the PR link - you don't have to touch the board
yourself. Same for deploys and releases. If nothing moved automatically,
check that the ticket key is actually in the branch name or PR title.

### Keyboard shortcuts (once you're comfortable)

| Key | Does |
|---|---|
| `Cmd/Ctrl+K` | Open the command palette - search any ticket or create one |
| `C` | Create a ticket (while on a board) |
| `G` then `B` | Go to the current project's board |
| `G` then `S` | Go to Backlog/Sprints |
| `G` then `R` | Go to Retros |
| `J` / `K` | Next / previous ticket |
| `A` | Assign the open ticket to yourself |
| `/` | Focus search |
| `?` | Show this list on-screen |
| `Esc` | Close whatever's open |

### What OfficePM is not

No Gantt charts, no automation builder, no custom fields, no Slack
notifications, no mobile app, no per-project permissions - everyone
logged in can see every project, on purpose, because this is a small
office. If something feels missing, it's probably intentional for v1 -
tell your admin and it'll go on the list for a real complaint, not a
guess.
