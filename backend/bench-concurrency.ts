import Database from "better-sqlite3";
import { RnpmClient } from "./src/services/rnpmClient.ts";

const DB_PATH = process.argv[2] ?? "../legal-dashboard-dev.db";
const N_DOCS = Number.parseInt(process.argv[3] ?? "25", 10);
const LEVELS = [3, 5, 7, 10, 15];

const db = new Database(DB_PATH, { readonly: true });
const rows = db
  .prepare(
    "SELECT uuid, identificator, created_at FROM rnpm_avize WHERE uuid IS NOT NULL AND uuid != '' ORDER BY created_at DESC LIMIT ?"
  )
  .all(N_DOCS) as { uuid: string; identificator: string; created_at: string }[];
db.close();

console.log(`Newest aviz: ${rows[0]?.identificator} created_at=${rows[0]?.created_at}`);
console.log(`Sample UUID: ${rows[0]?.uuid}`);

// Probe one UUID to check what response we get
const probeClient = new RnpmClient();
const probeStart = Date.now();
const probe = await probeClient.fetchPart(rows[0].uuid, 1);
console.log(`Probe part1 in ${Date.now() - probeStart}ms: ${probe === null ? "NULL (expired)" : "HAS DATA"}`);
if (probe === null) {
  console.log("UUID-urile sunt expirate. Benchmark-ul nu e valid.");
  process.exit(0);
}

if (rows.length === 0) {
  console.error("No UUIDs in DB. Run a search first.");
  process.exit(1);
}
console.log(`Benchmark: ${rows.length} avize × ${LEVELS.join(", ")} concurrency levels`);

const client = new RnpmClient();

async function runAt(concurrency: number): Promise<{ ms: number; errors: number }> {
  const start = Date.now();
  let errors = 0;
  for (let i = 0; i < rows.length; i += concurrency) {
    const slice = rows.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (r) => {
        try {
          await client.fetchFullDetail(r.uuid);
          return true;
        } catch {
          return false;
        }
      })
    );
    errors += results.filter((r) => !r).length;
  }
  return { ms: Date.now() - start, errors };
}

(async () => {
  for (const c of LEVELS) {
    process.stdout.write(`conc=${String(c).padStart(2)} ... `);
    const { ms, errors } = await runAt(c);
    const perDoc = (ms / rows.length).toFixed(0);
    console.log(`${(ms / 1000).toFixed(1)}s (${perDoc}ms/doc, ${errors} erori)`);
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
