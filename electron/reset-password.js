// Developer-only tool — not packaged into the installed app (see the
// "!**/node_modules/bcryptjs/**" exclusion in package.json's build.files).
//
// This app is fully offline with no email/SMTP, so there's no self-service
// "forgot password" flow. If a client forgets their password, this is how
// it gets reset: point it at a copy of their PGlite data directory (e.g.
// a zip of their `fams-database` folder sent back to you, or the live
// folder if you're on their machine) while the app itself is NOT running
// (PGlite is single-writer — close the app first).
//
// Usage:
//   npm run reset-password -- /path/to/fams-database someusername newpassword
const path = require("path");
const bcrypt = require("bcryptjs");
const { PGlite } = require("@electric-sql/pglite");

async function main() {
  const [, , dbDir, username, newPassword] = process.argv;
  if (!dbDir || !username || !newPassword) {
    console.error("Usage: npm run reset-password -- /path/to/fams-database <username> <new-password>");
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error("New password must be at least 8 characters.");
    process.exit(1);
  }

  const db = new PGlite(path.resolve(dbDir));
  try {
    const hash = bcrypt.hashSync(newPassword, 10);
    const result = await db.query("UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING username", [hash, username]);
    if (result.rows.length === 0) {
      console.error(`No user found with username "${username}". Check the exact spelling (it's case-sensitive).`);
      process.exitCode = 1;
    } else {
      console.log(`Password reset for "${username}" — they can log in with the new password now.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
