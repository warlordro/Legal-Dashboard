import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("=== Building Legal Dashboard ===\n");

// 1. Build frontend
console.log("[1/5] Building frontend...");
execSync("npm run build", { cwd: resolve(root, "frontend"), stdio: "inherit" });

// 2. Copy frontend dist to dist-frontend
// Clean first — cpSync merges over existing files, so stale hash-named chunks from
// previous builds would accumulate (22MB+ vs ~2.6MB fresh) and ship in the installer.
console.log("\n[2/5] Copying frontend build...");
rmSync(resolve(root, "dist-frontend"), { recursive: true, force: true });
mkdirSync(resolve(root, "dist-frontend"), { recursive: true });
cpSync(resolve(root, "frontend", "dist"), resolve(root, "dist-frontend"), { recursive: true });

// 3. Bundle backend with esbuild (CJS, all deps included)
console.log("\n[3/5] Bundling backend...");
rmSync(resolve(root, "dist-backend"), { recursive: true, force: true });
// --define:"import.meta.url"="\"\"" suppresses the empty-import-meta warning: the
// source has `fileURLToPath(import.meta.url)` as a fallback for the ESM dev path,
// but in the CJS bundle `typeof __dirname !== "undefined"` is always true so the
// fallback is dead code. Replace the token at compile time with an empty string.
execSync(
  `npx esbuild backend/src/index.ts --bundle --platform=node --format=cjs --outfile=dist-backend/index.cjs --sourcemap=external --define:"import.meta.url"="\\"\\"" --external:better-sqlite3 --external:electron`,
  { cwd: root, stdio: "inherit" }
);

// 4. Copy pdfkit's standard font metrics. Its CommonJS build reads these .afm
// files from __dirname/data at runtime, and esbuild does not inline them.
console.log("\n[4/5] Copying pdfkit font metrics...");
mkdirSync(resolve(root, "dist-backend", "data"), { recursive: true });
cpSync(resolve(root, "node_modules", "pdfkit", "js", "data"), resolve(root, "dist-backend", "data"), {
  recursive: true,
});

// 5. Copy migration .sql files alongside the bundle. esbuild does not bundle
// non-JS assets; runner.ts reads them at boot via fs.readdirSync(migrationsDir).
// In dev __dirname resolves to backend/src/db/; in CJS bundle to dist-backend/.
// Either way the runner expects a sibling `migrations/` directory.
//
// Positive whitelist: only *.up.sql + *.down.sql ship to dist-backend. Anything
// else (test files, sidecar TS, future README) stays out of the production bundle.
const MIGRATION_FILE = /\.(up|down)\.sql$/;
console.log("\n[5/5] Copying migration files...");
mkdirSync(resolve(root, "dist-backend", "migrations"), { recursive: true });
cpSync(resolve(root, "backend", "src", "db", "migrations"), resolve(root, "dist-backend", "migrations"), {
  recursive: true,
  filter: (src) => {
    // Directories must pass through so cpSync can recurse into nested folders
    // if a future migration ships sidecar resources (fixtures, etc).
    if (statSync(src).isDirectory()) return true;
    return MIGRATION_FILE.test(src);
  },
});

// v2.43.0 (rnpm-split): chain-ul separat pentru fisierele RNPM per user, citit
// de rnpmDb.ts din sibling-ul `migrations-rnpm/` — acelasi whitelist ca mai sus.
mkdirSync(resolve(root, "dist-backend", "migrations-rnpm"), { recursive: true });
cpSync(resolve(root, "backend", "src", "db", "migrations-rnpm"), resolve(root, "dist-backend", "migrations-rnpm"), {
  recursive: true,
  filter: (src) => {
    if (statSync(src).isDirectory()) return true;
    return MIGRATION_FILE.test(src);
  },
});

console.log("\n=== Build complete! ===");
