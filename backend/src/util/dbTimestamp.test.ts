import { afterEach, describe, expect, it } from "vitest";
import { parseDbTimestamp, toIsoUtcTimestamp, toNaiveUtcTimestamp } from "./dbTimestamp.ts";

// Cele doua formate din DB si conversiile intre ele. Testele fixeaza TZ-ul
// procesului pe ceva NEUTC, pentru ca exact acolo se vede bugul: cu offset 0
// interpretarea greșita a sirului naiv da acelasi rezultat ca cea corecta.
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) {
    // biome-ignore lint/performance/noDelete: process.env coerce undefined la "undefined"
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

describe("parseDbTimestamp", () => {
  it("citeste sirul naiv ca UTC, nu ca ora locala a procesului", () => {
    process.env.TZ = "Europe/Bucharest";
    expect(parseDbTimestamp("2026-07-29 22:38:31").toISOString()).toBe("2026-07-29T22:38:31.000Z");
    process.env.TZ = "Pacific/Honolulu";
    expect(parseDbTimestamp("2026-07-29 22:38:31").toISOString()).toBe("2026-07-29T22:38:31.000Z");
  });

  it("lasa neatinse sirurile cu zona explicita", () => {
    expect(parseDbTimestamp("2026-07-29T22:38:31.123Z").toISOString()).toBe("2026-07-29T22:38:31.123Z");
    expect(parseDbTimestamp("2026-07-29T22:38:31+03:00").toISOString()).toBe("2026-07-29T19:38:31.000Z");
  });

  it("intoarce Date invalid pentru input neparsabil", () => {
    expect(Number.isNaN(parseDbTimestamp("nu-i o data").getTime())).toBe(true);
  });
});

describe("toNaiveUtcTimestamp", () => {
  it("converteste ISO la formatul coloanei datetime('now')", () => {
    expect(toNaiveUtcTimestamp("2026-07-29T21:00:00.000Z")).toBe("2026-07-29 21:00:00");
  });

  it("lasa neatins un sir deja in formatul coloanei", () => {
    process.env.TZ = "Pacific/Honolulu";
    expect(toNaiveUtcTimestamp("2026-07-29 21:00:00")).toBe("2026-07-29 21:00:00");
  });

  it("intoarce inputul cand nu poate fi parsat (fail-open, nu arunca)", () => {
    expect(toNaiveUtcTimestamp("nu-i o data")).toBe("nu-i o data");
  });
});

describe("toIsoUtcTimestamp", () => {
  it("converteste sirul naiv la ISO cu Z", () => {
    process.env.TZ = "Europe/Bucharest";
    expect(toIsoUtcTimestamp("2026-07-29 21:00:00")).toBe("2026-07-29T21:00:00.000Z");
  });

  it("normalizeaza si un ISO deja valid (idempotent pe instant)", () => {
    expect(toIsoUtcTimestamp("2026-07-29T21:00:00Z")).toBe("2026-07-29T21:00:00.000Z");
  });

  it("intoarce inputul cand nu poate fi parsat", () => {
    expect(toIsoUtcTimestamp("nu-i o data")).toBe("nu-i o data");
  });
});
