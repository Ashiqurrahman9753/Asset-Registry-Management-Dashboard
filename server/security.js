// Security helpers for the backend: who may talk to it, response headers, request limits,
// password rules and input cleaning. No extra packages: it uses only Node's own modules.
const bcrypt = require("bcryptjs");

// ---------- Where requests may come from ----------

// The desktop app's own window is the only intended client. Requests whose Host or Origin
// is anything else (another computer, or a web page trying to reach the app through the
// browser) are refused.
function allowedHosts(port) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  for (const extra of String(process.env.FAMS_ALLOWED_HOSTS || "").split(",")) {
    if (extra.trim()) hosts.add(extra.trim().toLowerCase());
  }
  return hosts;
}

function allowedOrigins(port) {
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  // Only when the dashboard runs from its own dev server (not the desktop build).
  if (!process.env.SERVE_DASHBOARD) {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  for (const extra of String(process.env.FAMS_ALLOWED_ORIGINS || "").split(",")) {
    if (extra.trim()) origins.add(extra.trim());
  }
  return origins;
}

function hostGuard(port) {
  const hosts = allowedHosts(port);
  const origins = allowedOrigins(port);
  return (req, res, next) => {
    const host = String(req.headers.host || "").toLowerCase();
    if (!hosts.has(host)) return res.status(403).json({ error: "Not allowed" });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return res.status(403).json({ error: "Not allowed" });
    next();
  };
}

function corsOptions(port) {
  const origins = allowedOrigins(port);
  return {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}

// ---------- Response headers ----------

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (req.path.startsWith("/api")) {
    // Client records must never be kept in a cache.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

// ---------- Request limits ----------

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// A simple fixed-window counter per caller, held in memory.
function createLimiter({ windowMs, max, message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 30000));
  if (timer.unref) timer.unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = clientIp(req);
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message || "Too many requests. Please wait a moment and try again." });
    }
    next();
  };
}

// Sign-in attempts: after MAX_FAILS wrong passwords for a username (from anywhere) that
// sign-in is paused for LOCK_MS. A correct password clears the count.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map();

function loginLockMinutes(username) {
  const e = fails.get(String(username || "").toLowerCase());
  if (e && e.lockedUntil && e.lockedUntil > Date.now()) return Math.ceil((e.lockedUntil - Date.now()) / 60000);
  return 0;
}

function recordLoginFailure(username) {
  const key = String(username || "").toLowerCase();
  const now = Date.now();
  let e = fails.get(key);
  if (!e || (e.lockedUntil && e.lockedUntil <= now) || now - e.first > LOCK_MS) e = { count: 0, first: now, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= MAX_FAILS) e.lockedUntil = now + LOCK_MS;
  fails.set(key, e);
  // Keep the table small if someone sprays random usernames.
  if (fails.size > 5000) fails.delete(fails.keys().next().value);
}

function clearLoginFailures(username) {
  fails.delete(String(username || "").toLowerCase());
}

// ---------- Passwords ----------

const BCRYPT_COST = 12;
// Compared against when a username doesn't exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_COST);
}

// An older hash made with a lower cost is quietly replaced at the next successful sign-in.
function needsRehash(hash) {
  const m = /^\$2[abxy]?\$(\d{2})\$/.exec(String(hash || ""));
  return !m || Number(m[1]) < BCRYPT_COST;
}

const COMMON_PASSWORDS = new Set(["password", "password1", "12345678", "123456789", "1234567890", "qwertyui", "qwerty123", "iloveyou", "admin123", "letmein1", "welcome1", "abc12345", "11111111", "00000000"]);

// Returns an error message, or "" when the password is acceptable.
function passwordProblem(password, username) {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  // bcrypt only uses the first 72 bytes, so longer passwords would be silently cut.
  if (Buffer.byteLength(password, "utf8") > 72) return "Password can be at most 72 characters.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "That password is too easy to guess. Choose a different one.";
  if (username && password.toLowerCase().includes(String(username).toLowerCase()) && String(username).length >= 3) return "Password must not contain the username.";
  if (/^(.)\1+$/.test(password)) return "Password must not be one repeated character.";
  return "";
}

// ---------- Cleaning input ----------

// Control characters (except tab / newline) are dropped, ends are trimmed, and length is capped.
// Returns null for anything that isn't text.
function cleanText(value, max, { multiline = false } = {}) {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") return null;
  let s = String(value);
  s = s.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s));
const isEmail = (s) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(String(s || ""));

// Checks that a file's first bytes match the kind of file it claims to be.
function contentMatchesType(buffer, mime) {
  if (!buffer || buffer.length < 4) return false;
  const head = buffer.subarray(0, 1024);
  const startsWith = (...bytes) => bytes.every((b, i) => buffer[i] === b);
  const isPdf = head.includes("%PDF");
  const isJpeg = startsWith(0xff, 0xd8, 0xff);
  const isPng = startsWith(0x89, 0x50, 0x4e, 0x47);
  const isZip = startsWith(0x50, 0x4b, 0x03, 0x04);
  const isOle = startsWith(0xd0, 0xcf, 0x11, 0xe0);
  const isHeic = buffer.length > 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp";
  switch (mime) {
    case "application/pdf":
      return isPdf;
    case "image/jpeg":
    case "image/png":
      return isJpeg || isPng;
    case "image/heic":
      return isHeic;
    case "application/msword":
    case "application/vnd.ms-excel":
      return isOle || isZip;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return isZip;
    default:
      return false;
  }
}

module.exports = {
  hostGuard,
  corsOptions,
  securityHeaders,
  createLimiter,
  loginLockMinutes,
  recordLoginFailure,
  clearLoginFailures,
  hashPassword,
  needsRehash,
  DUMMY_HASH,
  passwordProblem,
  cleanText,
  isIsoDate,
  isEmail,
  contentMatchesType,
  BCRYPT_COST,
};
