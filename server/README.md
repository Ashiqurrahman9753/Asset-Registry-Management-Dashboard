# FAMS backend

The API for the Financial Asset Management System, backed by PostgreSQL —
logins, an audit trail, and automatic backups included.

## Setup

You need a Postgres database to point at. For local development, any
Postgres 13+ works (a local install, or a throwaway Docker container). For
going live, see "Choosing a database provider" below.

```bash
npm install
DATABASE_URL="postgres://user:password@host:5432/dbname" npm start
```

Or put it in a `.env`-style export before running `npm start` — either
way, **never commit `DATABASE_URL` or `FAMS_JWT_SECRET` to git**. The schema
is created automatically on first connect (`CREATE TABLE IF NOT EXISTS`, so
it's always safe to re-run).

Two environment variables matter:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `PGSSL` | only for managed providers | Set to `true` for Neon/Supabase/RDS/etc. — they require TLS. Leave unset for a local dev Postgres. |
| `FAMS_JWT_SECRET` | for production | Signs login tokens. Falls back to a well-known dev value locally — **must** be set to a real random secret before this is reachable from the internet. |

## Create your first login

There's no public sign-up form on purpose — for data this sensitive,
accounts should only be created deliberately by someone at the keyboard,
not through a form anyone on the internet could reach.

```bash
DATABASE_URL="..." node create-admin.js
```

Follow the prompts (username + password, 8 characters minimum). Once
created, log in via:

```bash
curl -X POST http://localhost:4000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"yourname","password":"yourpassword"}'
```

This returns a `token`. Every other request must include it:

```bash
curl http://localhost:4000/api/clients \
  -H "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
```

Tokens expire after 12 hours — staff log in once a day, not once per click.

## What the security layer actually does

- **Nothing works without logging in first** — every `/api/*` route requires
  a valid token. There is no anonymous read access to client or document data.
- **Check-out/check-in is tied to the real logged-in user**, not a name typed
  into a form — so the audit trail (`access_log`) can't be spoofed.
- **Every login attempt is recorded** (`login_log`), success or failure —
  so if something looks wrong later, you can see exactly who accessed the
  system and when, not just who claimed to.
- **Every edit to client particulars is recorded** (`client_edit_log`) —
  field, old value, new value, who, when. Editing is admin-only
  (`PATCH /api/clients/:id`).
- **Two roles**: `admin` can create new staff logins, view the login log,
  and edit client particulars; `staff` can use the register normally.

Add a second staff login (as an admin, once logged in):
```bash
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"staffname","password":"theirpassword","role":"staff"}'
```

## Choosing a database provider for going live

The app talks to Postgres through a single `DATABASE_URL` — any standard
Postgres host works, no code changes needed to switch providers. For a
2-person office at this scale (a few hundred clients, low traffic), a
managed serverless Postgres is the practical choice over running your own
server:

- **Neon** or **Supabase** — both have a free tier that comfortably covers
  this app's data volume, both include automated backups and TLS by
  default, and both hand you a connection string to paste into
  `DATABASE_URL`. Supabase adds extra features (auth, storage, realtime)
  this app doesn't use; Neon is Postgres-only and slightly simpler if you
  don't need those. Either is a reasonable pick — this is not a decision
  that locks you in, since the app only depends on standard Postgres.
- You'll also need somewhere to run the Express API itself (Render,
  Railway, or Fly.io all work) unless your database provider also offers
  app hosting.

Whichever you choose, set `PGSSL=true` and use a real random
`FAMS_JWT_SECRET` before the app is reachable from the public internet.

## Automatic backups — the safety net

```bash
DATABASE_URL="..." node backup.js
```

Dumps the database to a timestamped `.sql` file under `backups/` (via
`pg_dump` — install the `postgresql-client` package if it's not already on
your machine), and automatically deletes anything older than the last 14
backups. Managed providers like Neon/Supabase already keep their own
backups, but an independent, portable copy is worth having regardless —
it isn't tied to any one provider.

**Schedule it to run nightly:**

- **On Ubuntu (now, for testing):**
  ```bash
  crontab -e
  # add this line — runs every night at 11pm:
  0 23 * * * cd /path/to/fams-server && DATABASE_URL="..." node backup.js
  ```
- **On Windows (production):** use Task Scheduler → create a basic task →
  trigger "Daily" → action "Start a program" → program `node.exe`,
  arguments `backup.js`, start-in folder set to the `fams-server`
  directory, with `DATABASE_URL` set in the task's environment.

For extra safety, periodically copy the `backups/` folder itself onto a USB
drive or a personal cloud-sync folder (Google Drive/OneDrive).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/login` | — | Log in, get a token |
| GET | `/api/clients` | required | List all clients |
| POST | `/api/clients` | required | Add a client (file number assigned automatically) |
| PATCH | `/api/clients/:id` | admin only | Edit client particulars (every changed field is audit-logged) |
| GET | `/api/clients/:id/edit-log` | admin only | Edit history for a client |
| GET | `/api/documents` | required | List documents (filter with `?clientId=`, `?category=`, `?q=`) |
| POST | `/api/documents` | required | Log a new document |
| GET | `/api/documents/lookup/:code` | required | Scan/search lookup by unique ID — returns the full client snapshot |
| POST | `/api/documents/:id/toggle-checkout` | required | Check a document out or back in |
| GET | `/api/access-log` | required | Recent check-out/check-in history |
| GET | `/api/users` | admin only | List staff logins |
| POST | `/api/users` | admin only | Create a new staff login |
| GET | `/api/login-log` | admin only | Recent login attempts, success and failure |
