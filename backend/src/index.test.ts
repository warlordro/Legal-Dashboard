import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
    ...(env.LEGAL_DASHBOARD_AUTH_MODE === "web" ? { TENANT_KEY_ENCRYPTION_SECRET: TENANT_KEY_SECRET } : {}),
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

  // F15 audit hardening (v2.28.4): /health public expune doar status + service.
  // Detalii operationale (authMode, emailConfigured, monitoring) sunt mutate la
  // /health/detail, accesibil doar de pe loopback. Probele de mai jos verifica
  // ca /health/detail intoarce telemetry-ul corect cand sunt apelate local.
  it(
    "/health/detail exposes emailConfigured=false when SMTP_* env vars are missing (Batch 2.3)",
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
        LEGAL_DASHBOARD_AUTH_MODE: "web",
        LEGAL_DASHBOARD_JWT_SECRET: SECRET,
        LEGAL_DASHBOARD_JWT_ISSUER: "legal-dashboard.test",
        LEGAL_DASHBOARD_JWT_AUDIENCE: "legal-dashboard-api",
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
  });

  it("fails boot when remote bind is enabled in desktop auth mode", { timeout: 20_000 }, async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as typeof process.exit);

    await expect(
      importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(randomPort()),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_ALLOW_REMOTE: "1",
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
      })
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
