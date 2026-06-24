import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SECURITY sentinel: every TS file in frontend/src/lib that writes XLSX must
// also call sanitizeFormulaCells before the workbook is serialized.
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const XLSX_WRITE_PATTERNS = [
  /\b[A-Za-z_$][\w$]*\.utils\.book_append_sheet/,
  /\b[A-Za-z_$][\w$]*\.writeFile\s*\(/,
  /\b[A-Za-z_$][\w$]*\.write\s*\(/,
];
const SANITIZE_PATTERN = /sanitizeFormulaCells\s*\(/;

describe("xlsx formula injection audit", () => {
  it("toate fisierele care scriu xlsx cheama sanitizeFormulaCells", () => {
    const files = readdirSync(LIB_DIR).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts")
    );

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(LIB_DIR, file), "utf8");
      const writesXlsx = XLSX_WRITE_PATTERNS.some((pattern) => pattern.test(src));
      if (writesXlsx && !SANITIZE_PATTERN.test(src)) {
        offenders.push(file);
      }
    }

    expect(offenders, `fisiere care scriu xlsx fara sanitizeFormulaCells: ${offenders.join(", ")}`).toEqual([]);
  });
});
