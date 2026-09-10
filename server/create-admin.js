// One-time setup script to create the first admin login.
// Run: node create-admin.js
// There is no public "sign up" page on purpose — accounts for sensitive
// data should only ever be created deliberately, by someone with access
// to this machine, not from a form on the internet.

const readline = require("readline");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "fams.db"));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

(async () => {
  console.log("Create the first admin account for the Financial Asset Register.\n");
  const username = (await ask("Username: ")).trim();
  const password = await ask("Password: ");

  if (!username || password.length < 8) {
    console.error("\nUsername required, and password must be at least 8 characters. Aborting.");
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
    console.log(`\nAdmin account "${username}" created. You can now log in from the dashboard.`);
  } catch (err) {
    console.error("\nCould not create that account — username may already exist.");
  }
  rl.close();
})();
