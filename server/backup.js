// Automatic backup for the Financial Asset Register database.
// Run manually with: node backup.js
// Schedule it to run nightly (see README) so you always have a recent,
// portable copy independent of whatever the hosting provider keeps.
//
// Requires the `pg_dump` client tool (part of the postgresql-client package)
// to be installed and on PATH, matching the target server's Postgres version
// or newer.

require("dotenv").config();

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "backups");
const KEEP_LAST = 14; // days of backups to retain

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — nothing to back up.");
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(BACKUP_DIR, `fams-${stamp}.sql`);

execFile("pg_dump", [process.env.DATABASE_URL, "--no-owner", "--no-privileges", "-f", target], (err) => {
  if (err) {
    console.error("Backup failed:", err.message);
    process.exit(1);
  }
  console.log(`Backed up to ${target}`);

  // Prune anything older than KEEP_LAST backups.
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("fams-") && f.endsWith(".sql"))
    .sort(); // ISO timestamps sort chronologically as strings

  while (files.length > KEEP_LAST) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    console.log(`Removed old backup: ${oldest}`);
  }
});
