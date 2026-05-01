import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "0123456789abcdef0123456789abcdef";

let tmpRoots: string[] = [];
let originalEnv: NodeJS.ProcessEnv;

afterEach(async () => {
  await (globalThis as unknown as { __legalDashboardShutdown?: () => Promise<void> })
    .__legalDashboardShutdown?.();
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
  it("/health stays public in web mode and dev CORS allows Authorization", async () => {
    const port = randomPort();
    await importFreshIndex({
      LEGAL_DASHBOARD_PORT: String(port),
      LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
      LEGAL_DASHBOARD_AUTH_MODE: "web",
      LEGAL_DASHBOARD_JWT_SECRET: SECRET,
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

    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("fails boot when remote bind is enabled in desktop auth mode", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as typeof process.exit);

    await expect(
      importFreshIndex({
        LEGAL_DASHBOARD_PORT: String(randomPort()),
        LEGAL_DASHBOARD_DB_PATH: await makeTmpDb(),
        LEGAL_DASHBOARD_ALLOW_REMOTE: "1",
        LEGAL_DASHBOARD_AUTH_MODE: "desktop",
        LEGAL_DASHBOARD_ACK_NO_AUTH: "i-understand-no-auth-yet",
      }),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
