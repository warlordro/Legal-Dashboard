import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = pkg.version;
const outName = `legal-dashboard-server-${version}`;
const outDir = resolve(root, "server-release", outName);
const zipPath = resolve(root, "server-release", `${outName}.zip`);

console.log(`=== Building Legal Dashboard Server v${version} ===\n`);

// 1. Run main build (frontend + backend)
console.log("[1/4] Building frontend + backend...");
execSync("node --experimental-strip-types scripts/build.js", { cwd: root, stdio: "inherit" });

// 2. Assemble server package directory
console.log("\n[2/4] Assembling server package...");
if (existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

cpSync(resolve(root, "dist-backend"), join(outDir, "dist-backend"), { recursive: true });
cpSync(resolve(root, "dist-frontend"), join(outDir, "dist-frontend"), { recursive: true });
cpSync(resolve(root, "Dockerfile"), join(outDir, "Dockerfile"));
cpSync(resolve(root, "docker-compose.yml"), join(outDir, "docker-compose.yml"));
cpSync(resolve(root, "backend", ".env.example"), join(outDir, ".env.example"));
// Bare-metal ZIP runtime dependencies are intentionally installed on the target
// machine, not copied from the build machine: better-sqlite3 is a native module
// and a Windows-built node_modules would not run on Linux/Mac. Ship the exact
// lockfile + workspace manifests, then start.sh/start.bat run `npm ci` once if
// the native binding is missing.
cpSync(resolve(root, "package.json"), join(outDir, "package.json"));
cpSync(resolve(root, "package-lock.json"), join(outDir, "package-lock.json"));
mkdirSync(join(outDir, "backend"), { recursive: true });
mkdirSync(join(outDir, "frontend"), { recursive: true });
cpSync(resolve(root, "backend", "package.json"), join(outDir, "backend", "package.json"));
cpSync(resolve(root, "frontend", "package.json"), join(outDir, "frontend", "package.json"));

// Write a minimal start script
writeFileSync(
  join(outDir, "start.sh"),
  `#!/bin/sh
set -eu
if [ ! -d node_modules/better-sqlite3 ]; then
  echo "Installing runtime dependencies from package-lock.json..."
  npm ci --omit=dev --workspace=backend --include-workspace-root=false
fi
NODE_ENV=production node dist-backend/index.cjs
`
);
writeFileSync(
  join(outDir, "start.bat"),
  `@echo off
setlocal
if not exist node_modules\\better-sqlite3 (
  echo Installing runtime dependencies from package-lock.json...
  call npm ci --omit=dev --workspace=backend --include-workspace-root=false
  if errorlevel 1 exit /b %errorlevel%
)
set NODE_ENV=production
node dist-backend\\index.cjs
`
);
writeFileSync(
  join(outDir, "README.txt"),
  `Legal Dashboard Server v${version}
========================================

Cerinte: Node.js v22+

Pornire directa:
  Linux/Mac:  sh start.sh
  Windows:    start.bat

La prima pornire, scriptul instaleaza dependintele runtime din package-lock.json
cu npm ci daca lipseste node_modules/better-sqlite3. Este intentionat: better-sqlite3
este modul nativ si trebuie instalat pe platforma unde ruleaza serverul.

Pornire cu Docker:
  1. Copiaza .env.example in .env si completeaza cheile API (optional)
  2. docker-compose up -d

Aplicatia va fi disponibila la: http://localhost:3002

Cheile API (Claude/GPT/Gemini) pot fi configurate si din interfata aplicatiei.
`
);

// 3. Create ZIP
console.log("\n[3/4] Creating ZIP archive...");
mkdirSync(resolve(root, "server-release"), { recursive: true });

// Simple ZIP using recursive file collection + archiver-compatible approach via node:zlib + tar
// Using cross-platform approach with PowerShell (Windows) or zip (Unix)
const isWin = process.platform === "win32";
if (isWin) {
  execSync(`powershell -Command "Compress-Archive -Path '${outDir}' -DestinationPath '${zipPath}' -Force"`, {
    stdio: "inherit",
  });
} else {
  execSync(`cd "${resolve(root, "server-release")}" && zip -r "${zipPath}" "${outName}"`, {
    stdio: "inherit",
    shell: true,
  });
}

// 4. Cleanup temp dir
console.log("\n[4/4] Cleanup...");
rmSync(outDir, { recursive: true });

console.log(`\n=== Server package ready: server-release/${outName}.zip ===`);
