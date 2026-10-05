# Financial Asset Management System — Nav Ventures project

## What's in here

- **`server/`** — the backend: PostgreSQL database, REST API, login/auth,
  audit logging, automatic backups. See `server/README.md` for setup.
- **`dashboard/`** — the React dashboard (Vite app): Clients, Register, Scan
  lookup, Access log, bulk Excel/CSV client import. Fully wired to the
  backend API with a real login screen.
- **`labels/`** — the TSPL template for the Gainscha GS-2406T printer
  (60x40mm stock), plus an earlier SVG mockup for reference.

## Status

- [x] Backend API with clients, documents (register), access log
- [x] Login system (admin/staff roles), audit trail, backup script
- [x] Label design finalized and print-tested on the physical printer
- [x] Dashboard connected to the backend with a real login screen
- [x] Client detail view (company snapshot, directors, AGM tracking, audit
      trail on edits) and bulk Excel/CSV client import
- [x] Bulk box/bag intake workflow for walk-in document drop-offs
- [x] Migrated from local SQLite to PostgreSQL, ready for a managed cloud
      database (Neon/Supabase) so the app can be reached from anywhere
- [ ] Not yet actually deployed to a public host — still runs locally
      against whatever `DATABASE_URL` you point it at
- [ ] "Print label" button not yet wired to actually call the printer

## Getting set up on a fresh machine

You need a Postgres database first (see `server/README.md` for picking a
provider — a local Postgres or a throwaway Docker container is fine for
dev). Then:

```bash
cd server
npm install
DATABASE_URL="postgres://user:password@host:5432/dbname" node create-admin.js
DATABASE_URL="postgres://user:password@host:5432/dbname" npm start
```

In a second terminal:

```bash
cd dashboard
npm install
npm run dev
```

See `server/README.md` for the full setup, endpoint list, backup
scheduling, and database provider guidance.
