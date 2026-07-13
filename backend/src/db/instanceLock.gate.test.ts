// Rev. 5 (fix panel-pe-plan) — GARD DE REGRESIE (exceptie TDD documentata in
// plan): garantia critica a gate-ului de reclaim — un esec in interiorul
// reclaim-ului (rename refuzat) nu lasa gate orfan care sa blocheze
// reclaim-urile urmatoare 60s si nu mascheaza eroarea originala. Fisier
// SEPARAT: vi.mock pe node:fs e per-fisier si nu are ce cauta in suita
// principala instanceLock.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn((from: string, to: string) => {
      if (String(to).includes(".dead-") && process.env.__TEST_FAIL_RENAME === "1") {
        throw Object.assign(new Error("EPERM simulat la rename"), { code: "EPERM" });
      }
      return actual.renameSync(from, to);
    }),
    unlinkSync: vi.fn((p: import("node:fs").PathLike) => {
      if (String(p).endsWith(".reclaim-gate") && process.env.__TEST_FAIL_UNLINK_GATE === "1") {
        throw Object.assign(new Error("EPERM simulat la unlink"), { code: "EPERM" });
      }
      return actual.unlinkSync(p);
    }),
  };
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { acquireInstanceLock, releaseInstanceLock } from "./instanceLock.ts";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-instgate-"));
});

afterEach(async () => {
  releaseInstanceLock();
  // biome-ignore lint/performance/noDelete: env unset real.
  delete process.env.__TEST_FAIL_RENAME;
  // biome-ignore lint/performance/noDelete: env unset real.
  delete process.env.__TEST_FAIL_UNLINK_GATE;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

describe("withReclaimGate — exception safety (Rev. 5)", () => {
  it("rename refuzat in reclaim => eroarea se propaga, gate-ul NU ramane orfan, lock-ul vechi e intact", () => {
    fs.writeFileSync(path.join(tmpRoot, ".instance.lock"), "{ corupt"); // branch-ul de lock neparseabil
    process.env.__TEST_FAIL_RENAME = "1";

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/EPERM simulat/);
    expect(fs.existsSync(path.join(tmpRoot, ".instance.lock.reclaim-gate"))).toBe(false);
    expect(fs.readFileSync(path.join(tmpRoot, ".instance.lock"), "utf8")).toBe("{ corupt");

    // Dupa disparitia cauzei, reclaim-ul reuseste — gate-ul nu a ramas blocat.
    // biome-ignore lint/performance/noDelete: env unset real.
    delete process.env.__TEST_FAIL_RENAME;
    expect(() => acquireInstanceLock(tmpRoot, "test")).not.toThrow();
  });

  // Rev. 5.1 (Codex MEDIUM): daca gate-ul ORFAN nu poate fi sters (ACL
  // deny-delete, AV), mesajul nu are voie sa pretinda ca l-a "curatat" —
  // trebuie sa spuna explicit fisierul si cauza, ca operatorul sa stie in 10
  // secunde ce are de facut.
  it("gate orfan care NU poate fi sters => mesaj explicit cu fisierul si cauza, nu 'curatat'", () => {
    fs.writeFileSync(path.join(tmpRoot, ".instance.lock"), "{ corupt"); // branch-ul de reclaim
    const gate = path.join(tmpRoot, ".instance.lock.reclaim-gate");
    fs.writeFileSync(gate, "");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(gate, old, old); // gate ORFAN (peste GATE_STALE_MS)
    process.env.__TEST_FAIL_UNLINK_GATE = "1";

    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/NU a putut fi sters/i);
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/reclaim-gate/);
    expect(() => acquireInstanceLock(tmpRoot, "test")).toThrow(/EPERM/);
  });
});
