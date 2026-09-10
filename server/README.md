# FAMS backend

A small local API for the Financial Asset Management System. Single SQLite
file (`fams.db`), no separate database server to install or maintain —
now with logins, an audit trail, and automatic backups.

## Setup (Ubuntu now, Windows later — same steps, Node is cross-platform)

```bash
npm install
npm start
```

This creates `fams.db` next to `server.js` on first run and starts the API
on **http://localhost:4000**.

## Create your first login

There's no public sign-up form on purpose — for data this sensitive,
accounts should only be created deliberately by someone at the keyboard,
not through a form anyone on the internet could reach.

```bash
node create-admin.js
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
- **Two roles**: `admin` can create new staff logins and view the login log;
  `staff` can use the register normally. Given it's a 2-person office, this
  is intentionally simple — the owner/admin controls who gets an account at
  all, which is the main thing worth gating.

Add a second staff login (as an admin, once logged in):
```bash
curl -X POST http://localhost:4000/api/users \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"staffname","password":"theirpassword","role":"staff"}'
```

## Automatic backups — the safety net

```bash
node backup.js
```

Copies `fams.db` into a timestamped file under `backups/`, and automatically
deletes anything older than the last 14 backups.

**Schedule it to run nightly** so a hardware failure never costs you more
than a day of data:

- **On Ubuntu (now, for testing):**
  ```bash
  crontab -e
  # add this line — runs every night at 11pm:
  0 23 * * * cd /path/to/fams-server && node backup.js
  ```
- **On Windows (production):** use Task Scheduler → create a basic task →
  trigger "Daily" → action "Start a program" → program `node.exe`,
  arguments `backup.js`, start-in folder set to the `fams-server` directory.

For extra safety, periodically copy the `backups/` folder itself onto a USB
drive or a personal cloud-sync folder (Google Drive/OneDrive) — that
protects you even if the whole office PC is lost, not just the drive.

## Further hardening, if you want to go further later

The database file itself is currently unencrypted on disk — anyone with
direct file access to the PC could open `fams.db` with any SQLite tool.
Two options, roughly in order of effort:

1. **Turn on full-disk encryption** on the office PC (BitLocker on Windows,
   LUKS on Linux). This is the easiest win — it protects the file at rest
   if the PC or its drive is physically stolen, with no code changes needed.
2. **Switch to SQLCipher** (an encrypted drop-in replacement for SQLite) —
   this means the database file is unreadable without a passphrase even if
   copied off the machine. More setup effort (native build step), worth it
   once the system is in daily use with real client data.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/login` | — | Log in, get a token |
| GET | `/api/clients` | required | List all clients |
| POST | `/api/clients` | required | Add a client |
| GET | `/api/documents` | required | List documents (filter with `?clientId=`, `?category=`, `?q=`) |
| POST | `/api/documents` | required | Log a new document |
| GET | `/api/documents/lookup/:code` | required | Scan/search lookup by unique ID |
| POST | `/api/documents/:id/toggle-checkout` | required | Check a document out or back in |
| GET | `/api/access-log` | required | Recent check-out/check-in history |
| GET | `/api/users` | admin only | List staff logins |
| POST | `/api/users` | admin only | Create a new staff login |
| GET | `/api/login-log` | admin only | Recent login attempts, success and failure |

## Next step

The React dashboard prototype currently holds its data in memory (`useState`)
and has no login screen. Once this backend is running, the dashboard needs:
a login screen that stores the returned token, and every existing `fetch`
call updated to send `Authorization: Bearer <token>`.
