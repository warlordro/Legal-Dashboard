// Rev. 4 (Codex HIGH pe branch-ul rnpm-split): exclusivitatea multi-proces pe
// acelasi host nu are voie sa cada pe heartbeat — operatiile sincrone de boot
// (split, migratii, pre-migration backup) tin event loop-ul (si heartbeat-ul
// setInterval) blocat legitim peste pragul de staleness; un al doilea proces
// nu are voie sa fure lock-ul unui PID viu si sa opereze pe aceleasi fisiere.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";

let tmpRoot: string;
let originalForceBoot: string | undefined;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-instlock-"));
  originalForceBoot = process.env.LEGAL_DASHBOARD_FORCE_BOOT;
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Fara release, heartbeat-ul orfan al unui acquire reusit arunca "ownership
  // lost" flaky pe suita (capcana documentata in handoff).
  releaseInstanceLock();
  if (originalForceBoot === undefined) {
    // biome-ignore lint/performance/noDelete: env unset real.
    delete process.env.LEGAL_DASHBOARD_FORCE_BOOT;
  } else {
    process.env.LEGAL_DASHBOARD_FORCE_BOOT = originalForceBoot;
  }
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function writeForeignLock(overrides: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(tmpRoot, ".instance.lock"),
    JSON.stringify({
      pid: process.pid, // pid GARANTAT viu pe acelasi host: chiar procesul de test
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
      heartbeatAt: Date.now(),
      nonce: "nonce-strain",
      ...overrides,
    })
  );
}

// Mock DETERMINIST pe process.kill(pid, 0) — fara scanare de pid-uri. DOAR
// probele (semnal 0) pe pid-ul tinta sunt interceptate; restul trec real.
function mockPidProbe(pid: number, code: "ESRCH" | "EPERM"): void {
  const realKill = process.kill.bind(process);
  vi.spyOn(process, "kill").mockImplementation(((target: number, signal?: string | number) => {
    if (target === pid && signal === 0) {
      throw Object.assign(new Error(code), { code });
    }
    return realKill(target, signal as never);
  }) as typeof process.kill);
}

describe("acquireInstanceLock — exclusivitate pe acelasi host (Rev. 4)", () => {
  it("PID viu + heartbeat STALE => REFUZ (nu reclaim), cu hint de FORCE_BOOT", () => {
    // Heartbeat vechi de 10 minute — mult peste STALE_FACTOR * HEARTBEAT_MS.
    writeForeignLock({ heartbeatAt: Date.now() - 10 * 60 * 1000 });

    // Asertii SEPARATE: si refuzul, si hint-ul de break-glass.
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/FORCE_BOOT/);
    // Lock-ul strain a ramas NEATINS (nu a fost redenumit in .dead-*).
    expect(fs.existsSync(path.join(tmpRoot, ".instance.lock"))).toBe(true);
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
  });

  it("PID viu + heartbeat proaspat => REFUZ (regresie)", () => {
    writeForeignLock({});
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
  });

  it("proba de PID care da EPERM (proces viu sub alta identitate) => REFUZ fail-closed", () => {
    mockPidProbe(999_999, "EPERM");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
  });

  it("PID mort (ESRCH) => reclaim, chiar cu heartbeat PROASPAT (regresie)", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() });

    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });

  it("FORCE_BOOT=1 recupereaza si peste un PID viu (break-glass, regresie)", () => {
    writeForeignLock({ heartbeatAt: Date.now() - 10 * 60 * 1000 });
    process.env.LEGAL_DASHBOARD_FORCE_BOOT = "1";
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
  });
});

// Rev. 5 (Codex HIGH, critic pentru web): reclaim-ul unui lock mort trece
// printr-un GATE creat atomic (O_EXCL) — doua boot-uri concurente (docker
// restart pe acelasi volum) nu mai pot face AMBELE rename+write.
describe("acquireInstanceLock — reclaim atomic prin gate (Rev. 5)", () => {
  function gatePath(): string {
    return path.join(tmpRoot, ".instance.lock.reclaim-gate");
  }

  it("gate PROASPAT existent + lock mort => REFUZ fail-closed (alt proces recupereaza)", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });
    fs.writeFileSync(gatePath(), "");

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/recupereaza|reincearca/i);
    // Lock-ul strain si gate-ul strain raman neatinse.
    const kept = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(kept.nonce).toBe("nonce-strain");
    expect(fs.existsSync(gatePath())).toBe(true);
  });

  it("gate ORFAN (vechi) + lock mort => self-heal: gate-ul dispare, boot-ul curent refuza, urmatorul reuseste", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() - 10 * 60 * 1000 });
    fs.writeFileSync(gatePath(), "");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(gatePath(), old, old);

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/reincearca/i);
    expect(fs.existsSync(gatePath())).toBe(false); // self-heal
    // A doua incercare (semantica unei reporniri) reuseste.
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });

  // REGRESIE (trece si azi — gate-ul nici nu se creeaza inca): fluxul normal
  // de reclaim nu lasa gate in urma.
  it("reclaim reusit lasa gate-ul CURATAT (regresie pe fluxul normal)", () => {
    mockPidProbe(999_999, "ESRCH");
    writeForeignLock({ pid: 999_999, heartbeatAt: Date.now() });

    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    expect(fs.existsSync(gatePath())).toBe(false);
  });

  it("lock cu JSON neparseabil trece tot prin gate (gate proaspat => refuz)", () => {
    fs.writeFileSync(path.join(tmpRoot, ".instance.lock"), "{ corupt");
    fs.writeFileSync(gatePath(), "");

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/recupereaza|reincearca/i);
  });
});

// Cross-host: ramurile "neschimbate" primesc gard — o inversare accidentala a
// lui !stale ar fi trecut altfel de toata suita (fisierul e caracterizare noua).
describe("acquireInstanceLock — cross-host ramane pe heartbeat (regresie)", () => {
  it("host strain + heartbeat proaspat => REFUZ", () => {
    writeForeignLock({ hostname: "alt-host-inexistent", heartbeatAt: Date.now() });
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/detine lock-ul/i);
  });

  it("host strain + heartbeat stale => reclaim", () => {
    writeForeignLock({ hostname: "alt-host-inexistent", heartbeatAt: Date.now() - 10 * 60 * 1000 });
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
    const now = JSON.parse(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8"));
    expect(now.pid).toBe(process.pid);
  });
});
