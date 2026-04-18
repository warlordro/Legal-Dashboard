import { execSync } from "child_process";
import { cpSync, mkdirSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("=== Building Legal Dashboard ===\n");

// 1. Build frontend
console.log("[1/3] Building frontend...");
execSync("npm run build", { cwd: resolve(root, "frontend"), stdio: "inherit" });

// 2. Copy frontend dist to dist-frontend
// Clean first — cpSync merges over existing files, so stale hash-named chunks from
// previous builds would accumulate (22MB+ vs ~2.6MB fresh) and ship in the installer.
console.log("\n[2/3] Copying frontend build...");
rmSync(resolve(root, "dist-frontend"), { recursive: true, force: true });
mkdirSync(resolve(root, "dist-frontend"), { recursive: true });
cpSync(resolve(root, "frontend", "dist"), resolve(root, "dist-frontend"), { recursive: true });

// 3. Bundle backend with esbuild (CJS, all deps included)
console.log("\n[3/3] Bundling backend...");
rmSync(resolve(root, "dist-backend"), { recursive: true, force: true });
// --define:"import.meta.url"="\"\"" suppresses the empty-import-meta warning: the
// source has `fileURLToPath(import.meta.url)` as a fallback for the ESM dev path,
// but in the CJS bundle `typeof __dirname !== "undefined"` is always true so the
// fallback is dead code. Replace the token at compile time with an empty string.
execSync(
  `npx esbuild backend/src/index.ts --bundle --platform=node --format=cjs --outfile=dist-backend/index.cjs --sourcemap=external --define:"import.meta.url"="\\"\\"" --external:better-sqlite3 --external:electron`,
  { cwd: root, stdio: "inherit" }
);

console.log("\n=== Build complete! ===");
