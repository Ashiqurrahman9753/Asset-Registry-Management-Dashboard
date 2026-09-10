// Automatic backup for the Financial Asset Register database.
// Run manually with: node backup.js
// Schedule it to run nightly (see README) so you always have a recent
// copy even if the office PC's drive fails.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "fams.db");
const BACKUP_DIR = path.join(__dirname, "backups");
const KEEP_LAST = 14; // days of backups to retain

if (!fs.existsSync(DB_PATH)) {
  console.error("No fams.db found yet — nothing to back up.");
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(BACKUP_DIR, `fams-${stamp}.db`);

fs.copyFileSync(DB_PATH, target);
console.log(`Backed up to ${target}`);

// Prune anything older than KEEP_LAST backups.
const files = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => f.startsWith("fams-") && f.endsWith(".db"))
  .sort(); // ISO timestamps sort chronologically as strings

while (files.length > KEEP_LAST) {
  const oldest = files.shift();
  fs.unlinkSync(path.join(BACKUP_DIR, oldest));
  console.log(`Removed old backup: ${oldest}`);
}
