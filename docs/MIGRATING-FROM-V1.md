# Migrating from v1 to v2

v2 opens the database v1 created. There is no export or import: you point v2 at the
same `pm.db` and `uploads/` and start it. What makes that safe, and how to undo it,
is below. Read the whole page before you start, and take the backup in step 1.

## What carries over, and what changes

- **Carries over unchanged:** every user, password hash (v2 still uses bcrypt, so
  nobody resets a password), project, ticket, comment, sprint, retro, link, doc,
  uploaded file, and the ticket key counters.
- **One addition:** on first start v2 creates a table named `_officepm_migrations`
  and records the migration it applied. It adds no columns to v1's tables and
  rewrites no rows. Later v2 migrations are required to stay additive, so v1 can
  keep running on the same file.
- **Upload paths:** v1 stored each upload's absolute path in the database. v2
  re-roots the `uploads/(projects|tickets)/<id>/<file>` tail under the current
  `PM_DATA_DIR`, so moving the data directory, or mounting it at `/data` in Docker,
  works without editing any row. Paths containing `..` or NUL bytes are rejected.
- **Configuration:** the variable names are the same (`PORT`, `PM_DATA_DIR`,
  `PM_PROJECTS_FILE`, `PM_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`). New: `PM_WEB_DIR`
  and `PM_TRUST_PROXY`. `projects.json` is read as it is.
- **Behaviour differences you may notice:** an oversize request body is a 413 and a
  malformed JSON body a 400 (v1: 500); repeated failed logins get a 429; sprint dates
  must be real `YYYY-MM-DD` dates; attachment names keep their UTF-8 characters;
  responses carry stricter security headers. The full list is in the Phase 2 and
  Phase 4 notes of `docs/ARCHITECTURE-PLAN.md`.
- **GitHub Actions workflows need no change.** The three webhook endpoints, the
  `x-pm-token` header and the payloads are the same.

## 1. Stop v1 and back up

Stop the v1 server first. A copy of a live SQLite file in WAL mode can be torn, and
v1 has no backup command.

```bash
sudo systemctl stop officepm            # or however v1 runs
cd /home/office/officepm                # the v1 data directory
tar czf ~/pm-v1-backup-$(date +%F).tar.gz pm.db* projects.json uploads/
tar tzf ~/pm-v1-backup-$(date +%F).tar.gz | head    # confirm it lists pm.db and uploads/
```

Keep that archive somewhere that is not the data directory. It is your rollback.

## 2a. Run v2 from source

Copy the data to a directory of its own, so the v1 directory stays exactly as it was:

```bash
mkdir -p /var/lib/officepm
cp -a /home/office/officepm/pm.db /home/office/officepm/uploads /var/lib/officepm/
git clone https://github.com/Abydin/officepm.git && cd officepm
git checkout rewrite/v2                 # until v2 is merged to the default branch
pnpm install --frozen-lockfile && pnpm build
PM_DATA_DIR=/var/lib/officepm PM_PROJECTS_FILE=/home/office/officepm/projects.json \
  PM_TOKEN=<the value from v1's .env> pnpm start
```

Pass `PM_PROJECTS_FILE` if your `projects.json` differs from the one in the v2
repository, which is the stock file. The unit file in `ROLLOUT.md` shows the
long-running form.

## 2b. Run v2 in Docker

Copy the v1 files into the `officepm-data` volume, owned by the container's
unprivileged user (uid 1000), then start. From the directory that holds `pm.db` and `uploads/`:

```bash
docker compose build
docker run --rm --user root -v officepm-data:/data -v "$PWD":/from:ro --entrypoint sh officepm:v2 \
  -c 'cp -a /from/pm.db /data/ && { [ ! -d /from/uploads ] || cp -a /from/uploads /data/; } && chown -R node:node /data'
docker compose up -d
```

The image has the stock `projects.json` baked in. If yours differs, uncomment the
`projects.json` bind mount in `docker-compose.yml`. Set `PM_TOKEN` in `.env` to the
value v1 used so existing GitHub workflows keep working.

## 3. Check it

```bash
curl http://127.0.0.1:3000/api/health        # {"ok":true}
```

Sign in with an existing account, open a board, open a ticket with an attachment and
download it.

## Rolling back

The migration is additive, so v1 runs on a database v2 has touched; the data-compat
suite (`pnpm test:data-compat`) checks exactly this on seeded, old-shaped and
moved-upload databases: no row changes, v1 boots, logs in, and keeps allocating keys
from the same counter.

- **Roll back and keep what was entered in v2:** stop v2 and start v1 with its data
  directory set to the one v2 used (`PM_DATA_DIR=/var/lib/officepm`). For Docker,
  copy the files out of the volume first. Tickets, comments and uploads made in v2
  appear in v1. Uploaded files made under v2 are stored with absolute paths in the
  directory they were written to, so keep that directory in place while v1 uses it.
- **Roll back and discard v2 changes:** stop v2 and start v1 on the original,
  untouched v1 directory (the reason step 2a copies instead of moving). If you ran v2
  on the original directory, restore the archive from step 1 into an empty directory:
  `tar xzf ~/pm-v1-backup-DATE.tar.gz -C /home/office/officepm-restored`.

Either way you lose nothing from before the migration.

## Taking backups on v2 afterwards

v2 has a proper backup command (`pnpm backup`, or the Docker form in `ROLLOUT.md`
section 1.6). Use it instead of tar from now on.
