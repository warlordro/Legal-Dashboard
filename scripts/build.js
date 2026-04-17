import { execSync } from "child_process";
import { cpSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

console.log("=== Building Legal Dashboard ===\n");

// 1. Build frontend
console.log("[1/3] Building frontend...");
execSync("npm run build", { cwd: resolve(root, "frontend"), stdio: "inherit" });

// 2. Copy frontend dist to dist-frontend
console.log("\n[2/3] Copying frontend build...");
mkdirSync(resolve(root, "dist-frontend"), { recursive: true });
cpSync(resolve(root, "frontend", "dist"), resolve(root, "dist-frontend"), { recursive: true });

// 3. Bundle backend with esbuild (CJS, all deps included)
console.log("\n[3/3] Bundling backend...");
execSync(
  `npx esbuild backend/src/index.ts --bundle --platform=node --format=cjs --outfile=dist-backend/index.cjs --external:better-sqlite3 --external:electron`,
  { cwd: root, stdio: "inherit" }
);

console.log("\n=== Build complete! ===");
