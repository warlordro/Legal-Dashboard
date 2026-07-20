import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "0123456789abcdef0123456789abcdef";
const TENANT_KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

let tmpRoots: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

afterEach(async () => {
  await (globalThis as unknown as { __legalDashboardShutdown?: () => Promise<void> }).__legalDashboardShutdown?.();
  vi.restoreAllMocks();
  vi.resetModules();
  process.env = originalEnv;
  for (const tmp of tmpRoots) {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  }
  tmpRoots = [];
});

async function makeTmpDb(): Promise<string> {
  const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-index-"));
  tmpRoots.push(tmpRoot);
  return path.join(tmpRoot, "legal-dashboard.db");
}

function randomPort(): number {
  return 39_000 + Math.floor(Math.random() * 2_000);
}

async function importFreshIndex(env: NodeJS.ProcessEnv): Promise<void> {
  originalEnv = process.env;
  process.env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "",
    MONITORING_ENABLED: "0",
    ...(env.LEGAL_DASHBOARD_AUTH_MODE === "web"
      ? {
          TENANT_KEY_ENCRYPTION_SECRET: TENANT_KEY_SECRET,
          // NEW-02 (PR-5): web mode legat pe loopback cere TRUSTED_PROXY_CIDR, altfel gate-ul
          // strict fatalBoot (presupune reverse proxy co-locat). Clientii web-boot de test sunt
          // loopback legitimi (analog scripts/dev-web-local.ps1); ...env de mai jos lasa un test
          // care vrea sa exercite gate-ul strict sa suprascrie explicit acest default.
          LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR: "127.0.0.1/32",
        }
      : {}),
    ...env,
  };
  vi.resetModules();
  await import("./index.ts");
}

async function waitForHealth(port: number): Promise<Response> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200 || res.status === 503) return res;
    } catch (err) {
      lastError = err;
    }
    await delay(250);
  }
  throw new Error(`backend did not expose /health: ${String(lastError)}`);
}

describe("PR-9 index boot/auth boundaries", () => {
  it("/health stays public in web mode and dev CORS allows Authorization", { timeout: 20_000 }, async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "web",
      LEGAL_DASHBOARD_JWT_SECRET: SECRET,
      LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
      LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
    });

    const health = await waitForHealth(port);
    expect(health.status).toBe(200);

    const preflight = await fetch(`http://127.0.0.1:${port}/api/v1/me`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  it(
    "raspunsurile /api/* contin directiva no-store si private (inclusiv 4xx si rutele cu politici proprii)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({ LEGAL_DASHBOARD_PORT: String(port), LEGAL_DASHBOARD_DB_PATH: await makeTmpDb() });
      await waitForHealth(port);
      // Ruta deterministe locala (400 la validare, fara SOAP):
      const res = await fetch(`http://127.0.0.1:${port}/api/dosare?marker=x`);
      const cc = res.headers.get("cache-control") ?? "";
      expect(cc).toContain("no-store");
      expect(cc).toContain("private");
      // 404 API:
      const res404 = await fetch(`http://127.0.0.1:${port}/api/v1/ruta-inexistenta`);
      expect(res404.headers.get("cache-control") ?? "").toContain("no-store");
    }
  );

  // F15 audit hardening (v2.28.4): /health public expune doar status + service.
  // Detalii operationale (authMode, emailConfigured, monitoring) sunt mutate la
  // /health/detail, accesibil doar de pe loopback. Probele de mai jos verifica
  // ca /health/detail intoarce telemetry-ul corect cand sunt apelate local.
  // Bug 5 (v2.42.1): in web mode /health/detail e 403 neconditionat, deci
  // probele de telemetrie SMTP ruleaza pe desktop (detectia configului e
  // identica intre moduri).
  it(
    "/health/detail exposes emailConfigured=false when SMTP_* env vars are missing (Batch 2.3)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
        SMTP_HOST: "",
        SMTP_PORT: "",
        SMTP_USER: "",
        SMTP_PASS: "",
        SMTP_FROM: "",
      });

      await waitForHealth(port);
      const detail = await fetch(`http://127.0.0.1:${port}/health/detail`);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { emailConfigured: boolean };
      expect(body.emailConfigured).toBe(false);
    }
  );

  it(
    "/health/detail exposes authMode + loginAvailable=false while preserving Electron splash contract",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
      });

      await waitForHealth(port);
      const detail = await fetch(`http://127.0.0.1:${port}/health/detail`);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as {
        status: string;
        service: string;
        authMode: string;
        loginAvailable: boolean;
      };
      expect(body.status).toBe("ok");
      expect(body.service).toBe("Legal Dashboard API");
      expect(body.authMode).toBe("desktop");
      expect(body.loginAvailable).toBe(false);
    }
  );

  it(
    "/health/detail exposes emailConfigured=true with full SMTP_* config (Batch 2.3)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "587",
        SMTP_USER: "user",
        SMTP_PASS: "pass",
        SMTP_FROM: "alerts@example.test",
      });

      await waitForHealth(port);
      const detail = await fetch(`http://127.0.0.1:${port}/health/detail`);
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { emailConfigured: boolean };
      expect(body.emailConfigured).toBe(true);
    }
  );

  it("/health/detail intoarce 403 neconditionat in web mode (Bug 5 v2.42.1)", { timeout: 20_000 }, async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "web",
      LEGAL_DASHBOARD_JWT_SECRET: SECRET,
      LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
      LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
    });
    await waitForHealth(port);

    // Apel de pe loopback — exact scenariul reverse proxy same-host (Caddy,
    // oauth2-proxy) care pacalea gate-ul vechi. Web mode = 403 fara
    // telemetrie, indiferent de peer.
    const detail = await fetch(`http://127.0.0.1:${port}/health/detail`);
    expect(detail.status).toBe(403);
    expect(((await detail.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("/health public response strips operational telemetry (F15 audit hardening)", { timeout: 20_000 }, async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "desktop",
    });

    const health = await waitForHealth(port);
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("Legal Dashboard API");
    expect(body.authMode).toBeUndefined();
    expect(body.monitoring).toBeUndefined();
    expect(body.emailConfigured).toBeUndefined();
    expect(body.loginAvailable).toBeUndefined();
    // Bug 9 (v2.42.1): fara env-ul de boot nonce campul e omis complet
    // (server/web mode nu il emite niciodata).
    expect(body.bootNonce).toBeUndefined();
  });

  it(
    "/health ecoul bootNonce doar cand LEGAL_DASHBOARD_BOOT_NONCE e setat (Bug 9 v2.42.1)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
        LEGAL_DASHBOARD_BOOT_NONCE: "nonce-test-123",
      });
      const health = await waitForHealth(port);
      expect(health.status).toBe(200);
      const body = (await health.json()) as { bootNonce?: string };
      expect(body.bootNonce).toBe("nonce-test-123");
    }
  );

  it(
    "/health NU ecoul bootNonce in web mode, chiar cu env-ul setat (audit 2026-07-09)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
        LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
        LEGAL_DASHBOARD_BOOT_NONCE: "nonce-test-456",
      });
      const health = await waitForHealth(port);
      expect(health.status).toBe(200);
      const body = (await health.json()) as { bootNonce?: string };
      expect(body.bootNonce).toBeUndefined();
    }
  );

  it("fails boot when remote bind is enabled in desktop auth mode", { timeout: 20_000 }, async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as typeof process.exit);

    try {
      await expect(
        importFreshIndex({
          LEGAL_DASHBOARD_PORT: String(randomPort()),
          LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
          LEGAL_DASHBOARD_ALLOW_REMOTE: "1",
          LEGAL_DASHBOARD_AUTH_MODE: "desktop",
        })
      ).rejects.toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      // Boot-ul a luat instance lock-ul si a pornit heartbeat-ul INAINTE de
      // gate-ul care pica; in productie process.exit(1) real omoara timer-ul,
      // dar aici exit-ul e mock-uit si procesul de test traieste. Fara release,
      // heartbeat-ul orfan arunca "[instanceLock] ownership lost" la ~5s dupa
      // ce afterEach sterge tmpdir-ul — unhandled error flaky pe suita intreaga.
      // Import dupa vi.resetModules => ACEEASI instanta de modul ca boot-ul fresh.
      const { releaseInstanceLock } = await import("./db/instanceLock.ts");
      releaseInstanceLock();
    }
  });
});

// Task 4 (fixuri post-review): in web mode gate-ul de master key rula DUPA
// splitter — un TENANT_KEY_ENCRYPTION_SECRET lipsa aborta boot-ul cu monolitul
// DEJA golit si datele mutate in fisiere per-user (stare surprinzatoare pentru
// operator, desi recuperabila). Gate-ul trebuie sa pice INAINTE de split.
describe("ordinea de boot — master key INAINTE de rnpm split (Task 4)", () => {
  it(
    "web fara TENANT_KEY_ENCRYPTION_SECRET + monolit cu randuri rnpm => boot pica inainte de split",
    { timeout: 30_000 },
    async () => {
      const dbPath = await makeTmpDb();

      // Seed: schema completa + un rand rnpm in monolit, in sandbox de env +
      // registru de module separat de boot-ul real de mai jos.
      const prevDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
      process.env.LEGAL_DASHBOARD_DB_PATH = dbPath;
      vi.resetModules();
      try {
        const { getDb, closeDb } = await import("./db/schema.ts");
        getDb()
          .prepare("INSERT INTO rnpm_searches (owner_id, search_type, params_json) VALUES ('userA','dupa_nume','{}')")
          .run();
        closeDb();
      } finally {
        if (prevDbPath === undefined) {
          // biome-ignore lint/performance/noDelete: process.env trebuie unset real.
          delete process.env.LEGAL_DASHBOARD_DB_PATH;
        } else {
          process.env.LEGAL_DASHBOARD_DB_PATH = prevDbPath;
        }
      }

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as typeof process.exit);

      try {
        await expect(
          importFreshIndex({
            LEGAL_DASHBOARD_PORT: String(randomPort()),
            LEGAL_DASHBOARD_DB_PATH: dbPath,
            LEGAL_DASHBOARD_AUTH_MODE: "web",
            LEGAL_DASHBOARD_JWT_SECRET: SECRET,
            LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
            LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
            TENANT_KEY_ENCRYPTION_SECRET: "",
          })
        ).rejects.toThrow("process.exit called");
        expect(exitSpy).toHaveBeenCalledWith(1);

        // Monolitul e INTACT — splitter-ul nu a apucat sa goleasca nimic...
        const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
        try {
          const n = (probe.prepare("SELECT COUNT(*) AS n FROM rnpm_searches").get() as { n: number }).n;
          expect(n).toBe(1);
        } finally {
          probe.close();
        }
        // ...si nu exista fisiere per-user create de un split partial.
        const rnpmDir = path.join(path.dirname(dbPath), "rnpm");
        const perUser = fs.existsSync(rnpmDir) ? fs.readdirSync(rnpmDir).filter((f) => f.endsWith(".db")) : [];
        expect(perUser).toEqual([]);
      } finally {
        // Aceeasi ratiune ca la testul de remote-bind: elibereaza instance
        // lock-ul luat inainte de gate-ul care pica (heartbeat orfan flaky).
        const { releaseInstanceLock } = await import("./db/instanceLock.ts");
        releaseInstanceLock();
        // Boot-ul a deschis DB-ul (schema init explicit) inainte de gate-ul
        // care pica; fara close, rm-ul din afterEach da EBUSY pe Windows si
        // otraveste toate testele urmatoare. Acelasi registru de module ca
        // boot-ul (fara resetModules intre timp) => acelasi handle.
        const { closeDb } = await import("./db/schema.ts");
        closeDb();
      }
    }
  );
});

// Task 6 (fixuri post-review): prewarm-ul rnpm de la boot e un artefact
// desktop ("local" e singurul user acolo) — in web mode crea un fisier
// rnpm/local-*.db orfan pentru un owner care nu exista ca user real.
describe("igiena web-mode — prewarm rnpm gate-uit pe desktop (Task 6)", () => {
  it("boot web NU provisioneaza fisierul rnpm al ownerului 'local'", { timeout: 25_000 }, async () => {
    const port = randomPort();
    const dbPath = await makeTmpDb();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: dbPath,
      LEGAL_DASHBOARD_AUTH_MODE: "web",
      LEGAL_DASHBOARD_JWT_SECRET: SECRET,
      LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
      LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
    });
    await waitForHealth(port);

    const rnpmDir = path.join(path.dirname(dbPath), "rnpm");
    const localFiles = fs.existsSync(rnpmDir)
      ? fs.readdirSync(rnpmDir).filter((f) => f.startsWith("local-") && f.endsWith(".db"))
      : [];
    expect(localFiles).toEqual([]);
  });
});

// Task 16 (PAT piesa A) — bloc unic de montare web-mode + ordine load-bearing.
// Booteaza app-ul REAL (index.ts) in web mode, seed-uieste un PAT prin graful de module al
// app-ului (aceeasi conexiune DB), apoi conduce cereri HTTP reale.
describe("PAT surface — web-mode mount ordering (Task 16)", () => {
  const WEB = {
    LEGAL_DASHBOARD_AUTH_MODE: "web",
    LEGAL_DASHBOARD_JWT_SECRET: SECRET,
    LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
    LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
  } as const;

  async function bootWebWithPat(port: number, scopes: string[]): Promise<{ secret: string }> {
    await importFreshIndex({ LEGAL_DASHBOARD_PORT: String(port), LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(), ...WEB });
    await waitForHealth(port);
    // Seed prin graful de module deja incarcat (aceeasi conexiune DB ca app-ul).
    const { insertUser } = await import("./db/userRepository.ts");
    const { createApiToken } = await import("./db/apiTokenRepository.ts");
    insertUser({ id: "alice", email: "alice@example.com", displayName: "Alice", status: "active" });
    const { secret } = createApiToken({
      ownerId: "alice",
      name: "mcp",
      scopes,
      captchaDailyCap: null,
      expiresAt: null,
    });
    return { secret };
  }

  it(
    "default-denies a PAT on non-capability routes but allows its scoped route + reachable openapi",
    { timeout: 25_000 },
    async () => {
      const port = randomPort();
      const { secret } = await bootWebWithPat(port, ["rnpm"]);
      const h = { authorization: `Bearer ${secret}` };
      const base = `http://127.0.0.1:${port}`;

      // default-deny (403) pe rute in afara capabilitatilor
      expect((await fetch(`${base}/api/ai/models`, { headers: h })).status).toBe(403);
      expect((await fetch(`${base}/api/v1/me`, { headers: h })).status).toBe(403);
      expect((await fetch(`${base}/api/v1/admin/users`, { headers: h })).status).toBe(403);

      // management tokenuri: PAT respins cu cod dedicat
      const tokensRes = await fetch(`${base}/api/v1/tokens`, { headers: h });
      expect(tokensRes.status).toBe(403);
      expect(((await tokensRes.json()) as { error: { code: string } }).error.code).toBe("PAT_CANNOT_MANAGE_TOKENS");

      // ruta permisa (scope rnpm, citire locala) trece gate-ul + primeste no-store
      // (+ private, adaugat de merge-ul global E6 pe /api/*)
      const saved = await fetch(`${base}/api/rnpm/saved`, { headers: h });
      expect(saved.status).toBe(200);
      const savedCc = saved.headers.get("cache-control") ?? "";
      expect(savedCc).toContain("no-store");
      expect(savedCc).toContain("private");

      // openapi reachable de un PAT (montat inaintea gate-ului) — NU 403
      const spec = await fetch(`${base}/api/v1/openapi.json`, { headers: h });
      expect(spec.status).toBe(200);
      expect(((await spec.json()) as { openapi: string }).openapi).toMatch(/^3\./);

      // patUsageAudit inveleste gate-ul: cererea 403 a fost auditata ca denied
      const { getDb } = await import("./db/schema.ts");
      const denied = (
        getDb()
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='api_token.used' AND outcome='denied'")
          .get() as { n: number }
      ).n;
      expect(denied).toBeGreaterThan(0);
    }
  );

  it("does NOT mount the PAT surface in desktop mode (openapi + tokens are 404)", { timeout: 25_000 }, async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "desktop",
    });
    await waitForHealth(port);
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/api/v1/openapi.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/tokens`)).status).toBe(404);
  });
});

// Bug 1a (v2.42.2): plasa globala de body limit pe /api/* — testata prin app-ul
// REAL bootat din index.ts, NU prin app-uri izolate per-router: bugurile de
// ordine a middleware-ului sunt invizibile in teste izolate (exact asa a trecut
// Bug 1 de 1706 teste pe GitHub).
describe("global body limit — Bug 1a (v2.42.2)", () => {
  it(
    "web: POST >1MB pe /api/v1/tokens cu sesiune valida intoarce 413 PAYLOAD_TOO_LARGE",
    { timeout: 25_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
        LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
      });
      await waitForHealth(port);

      const { insertUser } = await import("./db/userRepository.ts");
      const { signAuthToken } = await import("./auth/jwt.ts");
      const { randomUUID } = await import("node:crypto");
      insertUser({ id: "u-bodylimit", email: "bodylimit@test.local", displayName: "Body Limit", role: "admin" });
      const nowSec = Math.floor(Date.now() / 1000);
      const jwt = signAuthToken(
        {
          sub: "u-bodylimit",
          jti: randomUUID(),
          iat: nowSec,
          exp: nowSec + 3600,
          iss: "legal-dashboard.test",
          aud: "legal-dashboard-api",
        },
        SECRET
      );

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/tokens`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ name: "x".repeat(1024 * 1024 + 1024) }),
      });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    }
  );

  it(
    "desktop: POST >1MB pe o ruta inexistenta intoarce 413 (plasa acopera tot /api/*)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
      });
      await waitForHealth(port);

      const res = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Legal-Dashboard-Desktop": "1" },
        body: JSON.stringify({ pad: "x".repeat(1024 * 1024 + 1024) }),
      });
      expect(res.status).toBe(413);
    }
  );

  it(
    "desktop: POST 1.5MB pe /api/v1/dosare/export.xlsx trece de plasa (validarea rutei, NU 413)",
    { timeout: 20_000 },
    async () => {
      const port = randomPort();
      await importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(port),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
      });
      await waitForHealth(port);

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/dosare/export.xlsx`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Legal-Dashboard-Desktop": "1" },
        body: JSON.stringify({ dosare: [], pad: "x".repeat(Math.floor(1.5 * 1024 * 1024)) }),
      });
      // Limita proprie a rutei e 25MB; 1.5MB trebuie sa ajunga la validarea
      // payload-ului (lista goala => 400), nu la plasa globala (413).
      expect(res.status).toBe(400);
    }
  );

  it("desktop: POST >25MB pe o ruta exceptata e taiat de plafonul exterior (413)", { timeout: 25_000 }, async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "desktop",
    });
    await waitForHealth(port);

    // Audit advers 2026-07-09: exceptia nu e next() gol — rutele cu payload
    // mare legitim au plafon exterior 25MB, deci limita per-ruta ramane
    // defense-in-depth, nu singura aparare.
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/dosare/export.xlsx`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Legal-Dashboard-Desktop": "1" },
      body: JSON.stringify({ dosare: [], pad: "x".repeat(26 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});

// EXT-H-01 (audit v2.43.0): la shutdown cu un maintenance writer care nu face
// settle in plafon, instance lock-ul NU se elibereaza — ramane pe disc si e
// recuperat ca stale la urmatorul boot (fail-safe contra "a doua instanta
// porneste curat peste un swap in zbor").
describe("shutdown — lock retention cu writer nesettled (EXT-H-01)", () => {
  it("lock-ul de instanta NU se elibereaza cand un writer nu face settle in plafon", async () => {
    const port = randomPort();
    const dbPath = await makeTmpDb();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: dbPath,
      LEGAL_DASHBOARD_SETTLE_TIMEOUT_MS: "100",
    });
    await waitForHealth(port);

    const { withMaintenanceWrite } = await import("./db/backup.ts");
    let release: () => void = () => {};
    let writerStarted = false;
    const hung = withMaintenanceWrite(() => {
      // Body-ul ruleaza DOAR dupa ce lock-ul e efectiv detinut si writer-ul e
      // inregistrat in settle-set. Un singur setImmediate nu era suficient pe
      // scheduling-ul macOS (race: settle-set gol -> lock eliberat -> fals FAIL).
      writerStarted = true;
      return new Promise<void>((r) => {
        release = r;
      });
    });
    await vi.waitFor(() => expect(writerStarted).toBe(true));

    const shutdown = (globalThis as unknown as { __legalDashboardShutdown?: () => Promise<void> })
      .__legalDashboardShutdown;
    expect(shutdown).toBeDefined();
    await shutdown?.();

    const lockPath = path.join(path.dirname(dbPath), ".instance.lock");
    expect(fs.existsSync(lockPath)).toBe(true); // retinut intentionat

    release();
    await hung.catch(() => {
      /* DB-ul e inchis de shutdown; esecul writerului e asteptat aici */
    });
  }, 30_000);
});

// E2 (audit v2.43.0): logger-ul Hono implicit scria URL-ul COMPLET — nume de
// parti, numere de dosar si alte filtre juridice ajungeau in stdout, persistat
// de colectoarele de log Docker. Middleware-ul inlocuitor logheaza doar
// pathname + status, fara query string.
describe("logger HTTP — fara query string (E2)", () => {
  it("logger-ul HTTP nu scrie query string-ul (PII juridic) — doar pathname", { timeout: 20_000 }, async () => {
    const logSpy = vi.spyOn(console, "log"); // INAINTE de importFreshIndex
    const port = randomPort();
    await importFreshIndex({ LEGAL_DASHBOARD_PORT: String(port), LEGAL_DASHBOARD_DB_PATH: await makeTmpDb() });
    await waitForHealth(port);
    // Cerere care pica determinist la validare (400) INAINTE de orice apel SOAP:
    const res = await fetch(`http://127.0.0.1:${port}/api/dosare?marker=NUME-FOARTE-SENSIBIL`);
    expect(res.status).toBe(400);
    const lines = logSpy.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines.some((l) => l.includes("NUME-FOARTE-SENSIBIL"))).toBe(false);
    expect(lines.some((l) => l.includes('"path":"/api/dosare"') && l.includes('"status":400'))).toBe(true);
    logSpy.mockRestore();
  });
});
