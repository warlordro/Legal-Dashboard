const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");

function hasInstalledModule(name) {
  return fs.existsSync(path.join(rootDir, "node_modules", name));
}

const modules = ["better-sqlite3"];

if (process.platform === "win32" && hasInstalledModule("windows-notification-state")) {
  modules.push("windows-notification-state");
}

if (process.platform === "darwin" && hasInstalledModule("macos-notification-state")) {
  modules.push("macos-notification-state");
}

console.log(`[rebuild:electron] rebuilding native modules: ${modules.join(", ")}`);

// Invoke @electron/rebuild directly through Node to avoid shell:true / DEP0190
// and npx/PATHEXT ambiguity on Windows.
const rebuildMain = require.resolve("@electron/rebuild");
const rebuildCli = path.join(path.dirname(rebuildMain), "cli.js");
const args = [rebuildCli, "-f", "-o", modules.join(",")];

const result = spawnSync(process.execPath, args, {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[rebuild:electron] failed to spawn: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
