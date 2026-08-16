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

// Descoperirea foloseste un criteriu INDEPENDENT de setarea testata: fisierele care
// definesc serviciul de autentificare. O versiune anterioara filtra chiar dupa
// `OAUTH2_PROXY_SKIP_AUTH_ROUTES`, deci stergerea completa a setarii scotea fisierul
// din lista si testul trecea verde — exact regresia pe care trebuia sa o prinda.
// (Demonstrat prin mutatie inainte de corectie.)
function composeFilesWithAuthProxy(): string[] {
  const roots = [repoRoot(), path.join(repoRoot(), "deploy")];
  const found: string[] = [];
  for (const dir of roots) {
    for (const name of fs.readdirSync(dir)) {
      if (!/^docker-compose.*\.ya?ml$/.test(name)) continue;
      const full = path.join(dir, name);
      if (/^\s{2}oauth2-proxy:/m.test(fs.readFileSync(full, "utf8"))) found.push(full);
    }
  }
  return found;
}

// Cauta ASIGNAREA, nu prima linie care CONTINE numele. Un comentariu care mentioneaza
// setarea (documentatie, nota de schimbare) era luat drept valoare, si testul pica desi
// configuratia era corecta. O alarma falsa e la fel de daunatoare ca un verde fals:
// duce la slabirea asertiei. Demonstrat prin mutatie inainte de corectie — un comentariu
// inserat deasupra setarii facea testul rosu.
function skipRoutesOf(file: string): string[] {
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => !l.startsWith("#") && /^OAUTH2_PROXY_SKIP_AUTH_ROUTES\s*:/.test(l));
  const value = /:\s*"(.*)"\s*$/.exec(line ?? "")?.[1] ?? "";
  // In compose, `$` se scrie `$$` (escape de interpolare).
  return value.split(",").map((entry) => entry.replace(/\$\$/g, "$"));
}

describe("ruta de confirmare a delogarii e publica in toate stack-urile", () => {
  it("gaseste toate stack-urile cu proxy de autentificare", () => {
    // Fara asta, testul ar trece vacuu daca fisierele s-ar redenumi.
    expect(composeFilesWithAuthProxy().length).toBeGreaterThan(0);
  });

  it.each(composeFilesWithAuthProxy())("%s chiar DEFINESTE lista de rute publice", (file) => {
    // Separat de verificarea continutului: stergerea completa a setarii trebuie sa
    // pice aici, nu sa scoata tacut fisierul din acoperire.
    expect(fs.readFileSync(file, "utf8")).toMatch(/OAUTH2_PROXY_SKIP_AUTH_ROUTES/);
  });

  it.each(composeFilesWithAuthProxy())("%s excepteaza /delogat", (file) => {
    expect(skipRoutesOf(file)).toContain(REQUIRED);
  });
});

// Rutele publice sunt sigure DOAR daca path-ul pe care il vede proxy-ul nu poate fi
// ales de client. `REVERSE_PROXY=true` fara `TRUSTED_PROXY_IPS` inseamna, dupa
// documentatia upstream, incredere in `X-Forwarded-*` de la ORICE sursa - cu doar un
// avertisment la pornire. Cum lista de rute publice se compara pe PATH, un
// `X-Forwarded-Uri` trimis de client poate face o ruta protejata sa treaca drept
// publica, adica ocolirea autentificarii.
//
// Doua straturi, cerute amandoua de advisory-ul upstream: ingress-ul STERGE antetul,
// iar proxy-ul are incredere doar in reteaua interna.
describe("path-ul vazut de proxy nu poate fi ales de client", () => {
  it.each(composeFilesWithAuthProxy())("%s restrange increderea in antetele de rutare", (file) => {
    expect(fs.readFileSync(file, "utf8")).toMatch(/OAUTH2_PROXY_TRUSTED_PROXY_IPS/);
  });

  it("ingress-ul Caddy sterge X-Forwarded-Uri", () => {
    // Caddy transmite implicit antetele primite daca nu exista un `header_up -...`
    // explicit, iar el e proxy de INCREDERE pentru oauth2-proxy.
    const caddy = path.join(repoRoot(), "deploy", "Caddyfile");
    expect(fs.readFileSync(caddy, "utf8")).toMatch(/header_up\s+-X-Forwarded-Uri/);
  });
});
