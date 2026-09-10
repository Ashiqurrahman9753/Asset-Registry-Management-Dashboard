# Financial Asset Management System — Nav Ventures / Mohan Management project

## What's in here

- **`server/`** — the backend: SQLite database, REST API, login/auth, audit
  logging, automatic backups. See `server/README.md` for setup.
- **`dashboard/`** — the React dashboard prototype (Clients, Register, Scan
  lookup, Access log). Currently uses in-memory sample data; next step is
  wiring it to `server/`'s API with a real login screen.
- **`labels/`** — the TSPL template for the Gainscha GS-2406T printer
  (60x40mm stock), plus an earlier SVG mockup for reference.

## Status as of this handoff

- [x] Backend API with clients, documents (register), access log
- [x] Login system (admin/staff roles), audit trail, nightly backup script
- [x] Label design finalized and print-tested on the physical printer
- [ ] Dashboard not yet connected to the backend (still in-memory)
- [ ] Dashboard has no login screen yet
- [ ] CSV import of the real 150-client list not yet built
- [ ] "Print label" button not yet wired to actually call the printer

## Getting set up on a fresh machine (dev now, Windows office box later)

```bash
cd server
npm install
node create-admin.js      # create your first login
npm start                  # runs the API on localhost:4000
```

See `server/README.md` for the full setup, endpoint list, and backup
scheduling instructions (cron on Linux, Task Scheduler on Windows).

## Recommended workflow from here

This project was built inside a chat interface, one file at a time. For
ongoing local development — live-editing files directly on disk, running
`npm install`/`node server.js` yourself, committing to git, and eventually
copying or cloning this whole folder onto the client's Windows office
machine — **Claude Code** is the right tool going forward, not this chat.
