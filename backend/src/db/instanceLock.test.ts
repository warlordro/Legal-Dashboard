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
import { __setHeartbeatFatalHandlerForTests, acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";

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

// INT-H1/INT-H2 (audit v2.43.0): heartbeat-ul nu are voie sa arunce in
// setInterval (devine uncaughtException, fara handler in index.ts) — erorile
// tranzitorii sar tick-ul LOGAT; pierderea reala de ownership declanseaza
// handlerul fatal (in productie: shutdown graceful + exit). Invariant de timp:
// 3 tick-uri sarite = 15s < pragul de stale de 30s.
describe("heartbeat resilient (INT-H1) + dual-holder (INT-H2)", () => {
  const lockFile = (): string => path.join(tmpRoot, ".instance.lock");

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    __setHeartbeatFatalHandlerForTests(null);
    vi.useRealTimers();
  });

  it("lock ilizibil tranzitoriu => skip tick cu instance_lock.heartbeat_skip logat, fara fatal; isi revine", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    acquireInstanceLock(tmpRoot, "test");
    const saved = fs.readFileSync(lockFile(), "utf8");
    fs.writeFileSync(lockFile(), "{corupt");
    vi.advanceTimersByTime(5_000); // 1 tick
    expect(fatal).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("instance_lock.heartbeat_skip"))).toBe(
      true
    );
    fs.writeFileSync(lockFile(), saved);
    vi.advanceTimersByTime(5_000); // recovery: contorul se reseteaza
    expect(fatal).not.toHaveBeenCalled();
    // Inca 2 tick-uri cu lock sanatos — nu se acumuleaza spre pragul fatal.
    vi.advanceTimersByTime(10_000);
    expect(fatal).not.toHaveBeenCalled();
  });

  it("lock ilizibil 3 tick-uri consecutive => fatal (fail-safe inainte de pragul de stale)", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    acquireInstanceLock(tmpRoot, "test");
    fs.writeFileSync(lockFile(), "{corupt");
    vi.advanceTimersByTime(15_000); // 3 tick-uri
    expect(fatal).toHaveBeenCalledTimes(1);
    // Dupa fatal, interval-ul e oprit: alte tick-uri nu re-apeleaza handlerul.
    vi.advanceTimersByTime(15_000);
    expect(fatal).toHaveBeenCalledTimes(1);
  });

  it("INT-H2: dupa reclaim de catre holder B, holderul A detecteaza mismatch la PRIMUL tick si NU rescrie lock-ul lui B", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    acquireInstanceLock(tmpRoot, "test");
    // Simuleaza reclaim-ul lui B: continut VALID cu alt pid/nonce.
    const stolen = { ...JSON.parse(fs.readFileSync(lockFile(), "utf8")), pid: 99_999, nonce: "b-nonce" };
    fs.writeFileSync(lockFile(), JSON.stringify(stolen));
    vi.advanceTimersByTime(5_000); // primul tick al lui A dupa furt
    expect(fatal).toHaveBeenCalledTimes(1); // imediat, nu dupa 3 miss-uri
    // A nu a rescris lock-ul peste B (dual-writer ar incepe exact asa):
    expect(JSON.parse(fs.readFileSync(lockFile(), "utf8")).nonce).toBe("b-nonce");
  });

  it("eroare I/O la scrierea heartbeat-ului => skip logat, fara fatal la primul tick", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    acquireInstanceLock(tmpRoot, "test");
    // Fara mock pe fs (importurile named ale SUT-ului nu se intercepteaza):
    // cu fake timers Date.now() e determinist, deci path-ul temp al tick-ului
    // urmator e predictibil — un DIRECTOR pre-creat acolo face writeFileSync
    // sa arunce EISDIR real, exact clasa de eroare I/O tranzitorie vizata.
    const tempPathAtNextTick = `${lockFile()}.heartbeat-${process.pid}-${Date.now() + 5_000}`;
    fs.mkdirSync(tempPathAtNextTick);
    vi.advanceTimersByTime(5_000);
    expect(fatal).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).some((l) => l.includes("instance_lock.heartbeat_skip"))).toBe(
      true
    );
    vi.advanceTimersByTime(5_000); // tick sanatos (alt timestamp => alt path): recovery
    expect(fatal).not.toHaveBeenCalled();
  });

  it("esec PERSISTENT de scriere (3 tick-uri consecutive) => fatal inainte de pragul de stale", () => {
    const fatal = vi.fn();
    __setHeartbeatFatalHandlerForTests(fatal);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    acquireInstanceLock(tmpRoot, "test");
    // Acelasi aranjament EISDIR ca mai sus, dar pe TOATE cele 3 tick-uri
    // urmatoare: citirea reuseste (lock-ul e al nostru), scrierea pica mereu.
    // Fara fatal, heartbeatAt de pe disc ingheata si alt proces poate face
    // reclaim la 30s cu ambele procese vii — contorul trebuie sa acumuleze
    // peste tick-uri cu read reusit + write esuat, nu sa se reseteze la read.
    const t0 = Date.now();
    for (const dt of [5_000, 10_000, 15_000]) {
      fs.mkdirSync(`${lockFile()}.heartbeat-${process.pid}-${t0 + dt}`);
    }
    vi.advanceTimersByTime(15_000);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(String(fatal.mock.calls[0]?.[0])).toContain("3");
  });
});
