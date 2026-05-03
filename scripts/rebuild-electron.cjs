const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["--yes", "@electron/rebuild", "-f", "-o", modules.join(",")];

console.log(`[rebuild:electron] rebuilding native modules: ${modules.join(", ")}`);

const result = spawnSync(npxCommand, args, {
  cwd: rootDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`[rebuild:electron] failed to start ${npxCommand}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
