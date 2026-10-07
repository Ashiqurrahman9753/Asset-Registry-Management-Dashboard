// Electron main process — the desktop shell around the existing FAMS
// backend/frontend. Runs a local embedded Postgres (PGlite, WASM, file-
// persisted) instead of Neon, so the whole app works fully offline with
// the client's data staying on their own machine. The server.js code
// itself is untouched — PGlite speaks the real Postgres wire protocol
// via pglite-socket, so DATABASE_URL just points at localhost instead
// of the cloud.
const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Node 18 (this dev machine) lacks global CustomEvent; Electron's bundled
// Node is modern enough not to need this, but the shim is harmless either
// way and keeps `npm start` here working the same as the packaged app.
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, opts = {}) {
      super(type);
      this.detail = opts.detail;
    }
  };
}

const SERVER_PORT = 4000;
const PGLITE_PORT = 55433;
let mainWindow;
let serverProcess;
let pgliteServer;
let pgliteDb;

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

// A packaged Windows app has no visible console — every console.log/error
// from here and from the spawned backend otherwise vanishes with nothing
// to debug from. Everything also goes to a log file so a failure can
// actually be diagnosed after the fact instead of guessed at.
let logStream;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")}`;
  console.log(line);
  if (logStream) logStream.write(line + "\n");
}

async function startPGlite() {
  const { PGlite } = require("@electric-sql/pglite");
  const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

  const dbDir = userDataPath("fams-database");
  fs.mkdirSync(dbDir, { recursive: true });

  pgliteDb = new PGlite(dbDir);
  // new PGlite(dbDir) returns before the database is actually ready to
  // accept queries — on a brand-new data directory (every client's very
  // first launch) its own internal bootstrap takes real time. Without this,
  // the socket server starts accepting connections immediately, and the
  // backend's first query can race ahead of PGlite actually being ready —
  // confirmed as the cause of a real "backend did not start" failure on a
  // first-ever install.
  await pgliteDb.waitReady;
  pgliteServer = new PGLiteSocketServer({ db: pgliteDb, port: PGLITE_PORT, host: "127.0.0.1" });
  await pgliteServer.start();
  log(`Local database ready at ${dbDir}`);
}

function startBackend() {
  return new Promise((resolve, reject) => {
    // Packaged app: server/ is unpacked alongside this file (see
    // electron-builder "extraResources" in package.json). Dev: it's the
    // sibling ../server directory in the repo.
    const serverDir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "server");
    const dashboardDist = app.isPackaged ? path.join(process.resourcesPath, "dashboard-dist") : path.join(__dirname, "..", "dashboard", "dist");

    serverProcess = spawn(process.execPath, [path.join(serverDir, "server.js")], {
      cwd: serverDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        DATABASE_URL: `postgres://postgres@127.0.0.1:${PGLITE_PORT}/postgres`,
        PGSSL: "false",
        // PGlite only processes one query at a time — pg's normal pool of
        // concurrent connections against it causes "Connection terminated
        // unexpectedly" errors under simultaneous requests (confirmed: the
        // dashboard's own page-load, which fires 4+ requests at once, 500s
        // on /api/documents, /api/access-log and /api/schedules without
        // this). Force everything through a single connection.
        PG_POOL_MAX: "1",
        PORT: String(SERVER_PORT),
        FAMS_JWT_SECRET: getOrCreateJwtSecret(),
        SERVE_DASHBOARD: path.relative(serverDir, dashboardDist),
        // Program Files (where a Windows install lives) usually isn't
        // writable by a standard user — uploaded documents and Postgres
        // backups go to the per-user app-data folder instead.
        UPLOAD_DIR: userDataPath("uploads"),
        LABEL_PRINTER_QUEUE: process.env.LABEL_PRINTER_QUEUE || "",
      },
    });

    let settled = false;
    const recentOutput = [];
    const remember = (line) => {
      recentOutput.push(line);
      if (recentOutput.length > 20) recentOutput.shift();
    };

    serverProcess.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      log("[backend]", text.trim());
      remember(text.trim());
      if (text.includes("FAMS backend running")) {
        settled = true;
        resolve();
      }
    });
    serverProcess.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      log("[backend:stderr]", text.trim());
      remember(text.trim());
    });
    serverProcess.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    serverProcess.on("exit", (code) => {
      log(`backend exited with code ${code}`);
      // The process dying before it ever printed "FAMS backend running" IS
      // the failure — report it immediately instead of silently waiting out
      // the rest of the startup timeout and showing a generic message that
      // hides what actually went wrong.
      if (settled) return;
      settled = true;
      reject(new Error(`Backend exited (code ${code}) before starting up. Last output:\n${recentOutput.join("\n")}`));
    });

    // Don't hang forever if something's wrong — surface it instead of a blank
    // window. A fresh install's first launch does real PGlite bootstrap work
    // (see startPGlite), so this allows real margin beyond that.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Backend did not start within 60 seconds. Last output:\n${recentOutput.join("\n")}`));
    }, 60000);
  });
}

// A random per-install JWT signing secret, persisted once — every login
// token this install issues stays valid across restarts, but a copy of
// the app on a different machine can't forge tokens for this one.
function getOrCreateJwtSecret() {
  const secretFile = userDataPath("jwt-secret.txt");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  const secret = require("crypto").randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, secret, "utf8");
  return secret;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 650,
    title: "Jardeen Management — Financial Asset Register",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const logDir = userDataPath("logs");
  fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(path.join(logDir, "startup.log"), { flags: "a" });

  try {
    await startPGlite();
    await startBackend();
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    const message = String(err && err.stack ? err.stack : err);
    log("STARTUP FAILED:", message);
    dialog.showErrorBox(
      "FAMS failed to start",
      `${message}\n\nFull startup log saved at:\n${path.join(logDir, "startup.log")}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  if (serverProcess) serverProcess.kill();
  if (pgliteServer) await pgliteServer.stop().catch(() => {});
  if (pgliteDb) await pgliteDb.close().catch(() => {});
});
