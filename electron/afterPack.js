// electron-builder hook, run after it assembles the app directory but
// before the installer is built (see "afterPack" in package.json's build
// config). Needed because electron-builder's extraResources copying has a
// hardcoded rule that silently strips any top-level `node_modules` folder
// from whatever it copies — by design, it assumes npm dependencies only
// ever need to travel through its own asar-packaging mechanism, which only
// applies to this app's own `files`, not to `extraResources` (server/).
// Confirmed by reading app-builder-lib's own source (util/filter.js):
// createFilter() returns false for any relative path exactly equal to
// "node_modules", unconditionally, regardless of the filter patterns
// configured — so server/node_modules never made it into the package no
// matter how extraResources.filter was written.
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, "..", "server", "node_modules");
  const to = path.join(context.appOutDir, "resources", "server", "node_modules");
  console.log(`[afterPack] copying ${from} -> ${to}`);
  fs.cpSync(from, to, { recursive: true });
};
