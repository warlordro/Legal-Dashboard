import { readdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonitoringAlertRow } from "../db/monitoringAlertsRepository.ts";
import { buildAlertsPdf } from "./alertsExportPdf.ts";
import type { AlertExportDecoratedRow } from "./alertsExportXlsx.ts";

const generatedFiles: string[] = [];

function makeAlert(overrides: Partial<MonitoringAlertRow> = {}): MonitoringAlertRow {
  return {
    id: 1,
    owner_id: "local",
    job_id: 10,
    run_id: 20,
    kind: "termen_new",
    severity: "warning",
    title: "Termen nou",
    detail_json: "{}",
    dedup_key: "dedup-1",
    is_new: 1,
    created_at: "2026-05-12T10:30:00.000Z",
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeRow(): AlertExportDecoratedRow {
  return {
    alert: makeAlert(),
    numarDosar: "123/3/2026",
    dosarLink: "https://portal.just.ro/SitePages/cautare.aspx?k=123%2F3%2F2026",
    kindLabel: "Termen nou",
    severityLabel: "Atentie",
    nameMonitored: "ACME SRL",
  };
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

describe("buildAlertsPdf", () => {
  it("produce PDF valid", async () => {
    const result = await buildAlertsPdf([makeRow()], "Selectie (1)");
    generatedFiles.push(result.filepath);

    expect(result.mime).toBe("application/pdf");
    expect(result.byteLength).toBeGreaterThan(1000);
    const bytes = await readFile(result.filepath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(result.filename).toMatch(/^alerte_1_.+\.pdf$/);
  });

  it("leaves no orphan tmp PDF when drawing throws (BUG-01)", async () => {
    const before = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
    const poisoned = [
      new Proxy(
        {},
        {
          get() {
            throw new Error("boom");
          },
        }
      ),
    ] as never;
    await expect(buildAlertsPdf(poisoned)).rejects.toThrow();
    const after = (await readdir(tmpdir())).filter((f) => f.startsWith("alerts-pdf-"));
    // Setul de fisiere NOI (after minus before) trebuie sa fie gol — asertia pe
    // lungime ar putea trece si cu un orfan daca alt proces sterge un fisier intre timp.
    expect(after.filter((f) => !before.includes(f))).toEqual([]);
  });

  it("rejects fast (nu atarna) cand write stream-ul da eroare async", async () => {
    // Simuleaza ENOSPC/EACCES: primul _write esueaza, streamul emite "error" apoi
    // "close" in timp ce finishWriteStream inca asteapta. Implementarea veche cu
    // once(stream,"close") atasa listener DUPA ce "close" a fost deja emis => atarna
    // permanent; finished(stream) se rezolva imediat pe stream deja inchis.
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      const { Writable } = await import("node:stream");
      return {
        ...actual,
        promises: actual.promises,
        createWriteStream: () => {
          let n = 0;
          return new Writable({
            write(_chunk, _enc, cb) {
              n += 1;
              cb(n === 1 ? new Error("ENOSPC: no space left on device") : null);
            },
          });
        },
      };
    });
    try {
      const { buildAlertsPdf: build } = await import("./alertsExportPdf.ts");
      await expect(build([makeRow()])).rejects.toThrow();
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
