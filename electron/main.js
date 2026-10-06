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

async function startPGlite() {
  const { PGlite } = require("@electric-sql/pglite");
  const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

  const dbDir = userDataPath("fams-database");
  fs.mkdirSync(dbDir, { recursive: true });

  pgliteDb = new PGlite(dbDir);
  pgliteServer = new PGLiteSocketServer({ db: pgliteDb, port: PGLITE_PORT, host: "127.0.0.1" });
  await pgliteServer.start();
  console.log(`[FAMS] Local database ready at ${dbDir}`);
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

    serverProcess.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      console.log("[FAMS backend]", text.trim());
      if (text.includes("FAMS backend running")) resolve();
    });
    serverProcess.stderr.on("data", (chunk) => console.error("[FAMS backend]", chunk.toString().trim()));
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) console.error(`[FAMS] backend exited with code ${code}`);
    });

    // Don't hang forever if something's wrong — surface it instead of a blank window.
    setTimeout(() => reject(new Error("Backend did not start within 20 seconds")), 20000);
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
  try {
    await startPGlite();
    await startBackend();
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    dialog.showErrorBox("FAMS failed to start", String(err && err.stack ? err.stack : err));
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
