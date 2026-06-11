// v2.37.1 (review cluster 5): fiecare .down.sql functional trebuie sa stearga
// si randul lui din _schema_versions. Fara DELETE, un rollback manual lasa
// runner-ul convins ca migratia e inca aplicata (sha256 match pe up) si nu o
// re-ruleaza la urmatorul upgrade — schema si jurnalul de versiuni diverg
// silentios. Exceptie: 0001_baseline.down.sql e un stub fail-loud intentionat
// (restaurarea pre-baseline se face din backup, nu din SQL).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// __dirname, nu import.meta.url — conventia repo-ului (CLAUDE.md "Nota
// Importanta Build": backend-ul e CJS; toate testele-frate de migratii
// folosesc acelasi pattern).
const dir = __dirname;

describe("down migrations clean up _schema_versions", () => {
  const downs = readdirSync(dir).filter((f) => f.endsWith(".down.sql"));

  it("exista down-uri de verificat", () => {
    expect(downs.length).toBeGreaterThan(30);
  });

  for (const file of downs) {
    const version = Number.parseInt(file.slice(0, 4), 10);
    if (version === 1) continue;
    it(`${file} sterge randul de versiune ${version}`, () => {
      const sql = readFileSync(join(dir, file), "utf8");
      expect(sql).toMatch(new RegExp(`DELETE FROM _schema_versions WHERE version = ${version};`));
    });
  }
});
