import { describe, expect, it } from "vitest";
import { formatRoDate, formatRoDateTime } from "./dateFormat.ts";

describe("formatRoDate", () => {
  it("returneaza '-' pentru null/undefined/empty", () => {
    expect(formatRoDate(null)).toBe("-");
    expect(formatRoDate(undefined)).toBe("-");
    expect(formatRoDate("")).toBe("-");
  });

  it("converteste YYYY-MM-DD la DD.MM.YYYY fara dependinta de TZ", () => {
    expect(formatRoDate("2026-05-13")).toBe("13.05.2026");
    expect(formatRoDate("2026-01-01")).toBe("01.01.2026");
    expect(formatRoDate("1999-12-31")).toBe("31.12.1999");
  });

  it("accepta ISO datetime cu prefix YYYY-MM-DD si ignora ora", () => {
    expect(formatRoDate("2026-05-13T00:00:00")).toBe("13.05.2026");
    expect(formatRoDate("2026-05-13T23:59:59Z")).toBe("13.05.2026");
    expect(formatRoDate("2026-05-13T01:00:00+02:00")).toBe("13.05.2026");
  });

  it("returneaza input ca string daca nu match (fallback safe)", () => {
    expect(formatRoDate("invalid")).toBe("invalid");
    expect(formatRoDate("13/05/2026")).toBe("13/05/2026");
  });

  it("NU se schimba in functie de TZ-ul masinii pentru date-only", () => {
    // Bugul anterior: new Date('2026-05-13') → UTC midnight → toLocale shift-uia
    // in TZ-uri vestice. Helper-ul nou face string extraction, nu Date math.
    const originalTZ = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      expect(formatRoDate("2026-05-13")).toBe("13.05.2026");
      process.env.TZ = "Asia/Tokyo";
      expect(formatRoDate("2026-05-13")).toBe("13.05.2026");
    } finally {
      if (originalTZ === undefined) {
        // biome-ignore lint/performance/noDelete: process.env coerce undefined la string "undefined", deci delete e singura optiune corecta
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTZ;
      }
    }
  });
});

describe("formatRoDateTime", () => {
  it("returneaza '-' pentru null/undefined/empty", () => {
    expect(formatRoDateTime(null)).toBe("-");
    expect(formatRoDateTime(undefined)).toBe("-");
    expect(formatRoDateTime("")).toBe("-");
  });

  it("formateaza ISO timestamps cu TZ explicit Europe/Bucharest", () => {
    // 2026-05-13T10:00:00Z = 13:00 in Bucharest (CEST, UTC+3)
    const result = formatRoDateTime("2026-05-13T10:00:00Z");
    expect(result).toMatch(/^13\.05\.2026/);
    expect(result).toContain("13:00");
  });

  it("returneaza input ca string daca Date e invalid", () => {
    expect(formatRoDateTime("not a date")).toBe("not a date");
  });
});
