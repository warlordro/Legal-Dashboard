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
});
