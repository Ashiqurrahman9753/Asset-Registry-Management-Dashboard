// One-time setup script to create the first admin login.
// Run: node create-admin.js
// There is no public "sign up" page on purpose — accounts for sensitive
// data should only ever be created deliberately, by someone with access
// to this machine, not from a form on the internet.

require("dotenv").config();

const readline = require("readline");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Point it at your Postgres instance first.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

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
    await pool.query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')", [username, hash]);
    console.log(`\nAdmin account "${username}" created. You can now log in from the dashboard.`);
  } catch (err) {
    console.error("\nCould not create that account — username may already exist.");
  }
  rl.close();
  await pool.end();
})();
