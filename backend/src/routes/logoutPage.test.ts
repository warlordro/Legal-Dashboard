import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logoutPageRouter } from "./logoutPage.ts";

// Ruta e izolata intr-un modul propriu tocmai ca sa poata fi testata fara sa
// porneasca aplicatia intreaga (baza, scheduler, migrari).

const ORIGINAL_MODE = process.env.LEGAL_DASHBOARD_AUTH_MODE;

function app(): Hono {
  const a = new Hono();
  a.route("/", logoutPageRouter);
  return a;
}

beforeEach(() => {
  process.env.LEGAL_DASHBOARD_AUTH_MODE = "web";
});

afterEach(() => {
  if (ORIGINAL_MODE === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real.
    delete process.env.LEGAL_DASHBOARD_AUTH_MODE;
  } else {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = ORIGINAL_MODE;
  }
});

describe("GET /delogat", () => {
  it("raspunde 200 cu HTML", async () => {
    const res = await app().request("/delogat");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  // Fara asta, un JWT re-mintuit in cursa de la logout ar supravietui: sign_out
  // sterge doar cookie-ul proxy-ului.
  it("sterge cookie-ul de sesiune, cu aceleasi atribute ca /auth/logout", async () => {
    const res = await app().request("/delogat");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("legal_dashboard_session=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
  });

  it("in modul desktop nu marcheaza cookie-ul Secure (nu exista HTTPS local)", async () => {
    process.env.LEGAL_DASHBOARD_AUTH_MODE = "desktop";
    const res = await app().request("/delogat");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("Secure");
  });

  // Pagina confirma o stare; cache-uita, ar putea fi servita dupa un login nou.
  it("nu e cache-uibila", async () => {
    const res = await app().request("/delogat");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // Scenariul din enuntul problemei: pe un calculator strain, delogarea din
  // aplicatie nu e suficienta cat timp sesiunea Google traieste.
  it("avertizeaza vizibil despre sesiunea Google ramasa", async () => {
    const body = await (await app().request("/delogat")).text();
    expect(body).toContain("Ai fost delogat");
    expect(body).toContain("accounts.google.com/Logout");
  });

  it("continutul e static: nu reflecta nimic din request", async () => {
    const withQuery = await (await app().request("/delogat?rd=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).text();
    const plain = await (await app().request("/delogat")).text();
    expect(withQuery).toBe(plain);
    expect(withQuery).not.toContain("script>alert");
  });
});
