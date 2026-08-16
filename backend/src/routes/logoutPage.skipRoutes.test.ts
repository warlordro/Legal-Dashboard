// Pagina de confirmare a delogarii trebuie sa fie publica in FIECARE stack.
//
// Bug real, gasit la review: doar compose-ul de NAS o excepta. Cine instala pe un
// server obisnuit primea butonul de iesire rupt, si intr-un fel greu de
// diagnosticat: te deloghezi, pagina de confirmare cere autentificare, iar cu
// butonul de provider sarit Google te reconecteaza instant. Utilizatorul revine
// logat si crede ca butonul nu face nimic. Nicio eroare nicaieri.
//
// Ruta e declarata publica obligatoriu in `logoutPage.ts`; testul leaga acea
// declaratie de toate fisierele de deploy, ca sa nu mai poata diverge.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED = "GET=^/delogat$";

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

function composeFilesWithSkipRoutes(): string[] {
  const roots = [repoRoot(), path.join(repoRoot(), "deploy")];
  const found: string[] = [];
  for (const dir of roots) {
    for (const name of fs.readdirSync(dir)) {
      if (!/^docker-compose.*\.ya?ml$/.test(name)) continue;
      const full = path.join(dir, name);
      if (fs.readFileSync(full, "utf8").includes("OAUTH2_PROXY_SKIP_AUTH_ROUTES")) found.push(full);
    }
  }
  return found;
}

function skipRoutesOf(file: string): string[] {
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.includes("OAUTH2_PROXY_SKIP_AUTH_ROUTES"));
  const value = /:\s*"(.*)"\s*$/.exec((line ?? "").trim())?.[1] ?? "";
  // In compose, `$` se scrie `$$` (escape de interpolare).
  return value.split(",").map((entry) => entry.replace(/\$\$/g, "$"));
}

describe("ruta de confirmare a delogarii e publica in toate stack-urile", () => {
  it("gaseste cel putin un compose cu lista de rute publice", () => {
    // Fara asta, testul ar trece vacuu daca fisierele s-ar redenumi.
    expect(composeFilesWithSkipRoutes().length).toBeGreaterThan(0);
  });

  it.each(composeFilesWithSkipRoutes())("%s excepteaza /delogat", (file) => {
    expect(skipRoutesOf(file)).toContain(REQUIRED);
  });
});
