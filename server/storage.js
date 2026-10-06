// File storage for document attachments — local disk today, swappable for
// R2 (or any S3-compatible store) later without touching callers or the
// database schema. storage_key is an opaque string; only this file knows
// it currently means "a path under UPLOAD_DIR".
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function makeStorageKey(originalFilename) {
  const ext = path.extname(originalFilename || "").slice(0, 10);
  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
}

async function saveFile(buffer, storageKey) {
  await fs.promises.writeFile(path.join(UPLOAD_DIR, storageKey), buffer);
}

async function readFile(storageKey) {
  return fs.promises.readFile(path.join(UPLOAD_DIR, storageKey));
}

async function deleteFile(storageKey) {
  await fs.promises.unlink(path.join(UPLOAD_DIR, storageKey)).catch(() => {});
}

module.exports = { makeStorageKey, saveFile, readFile, deleteFile };
