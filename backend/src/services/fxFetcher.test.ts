import Database from "better-sqlite3";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLatest } from "../db/fxRatesRepository.ts";
import { closeDb, getDb } from "../db/schema.ts";
import { computeUsdToEur, fetchEcbDailyRates, parseEcbFeed } from "./fxFetcher.ts";

let tmpRoot: string;
const originalDbPath = process.env.LEGAL_DASHBOARD_DB_PATH;
const originalFxMin = process.env.FX_PLAUSIBLE_EUR_USD_MIN;
const originalFxMax = process.env.FX_PLAUSIBLE_EUR_USD_MAX;

beforeEach(async () => {
  tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ld-fx-"));
  process.env.LEGAL_DASHBOARD_DB_PATH = path.join(tmpRoot, "legal-dashboard.db");
  const seed = new Database(process.env.LEGAL_DASHBOARD_DB_PATH);
  seed.close();
  getDb();
});

afterEach(async () => {
  closeDb();
  if (originalDbPath === undefined) {
    // biome-ignore lint/performance/noDelete: process.env trebuie unset real, nu valoare undefined.
    delete process.env.LEGAL_DASHBOARD_DB_PATH;
  } else {
    process.env.LEGAL_DASHBOARD_DB_PATH = originalDbPath;
  }
  restoreEnv("FX_PLAUSIBLE_EUR_USD_MIN", originalFxMin);
  restoreEnv("FX_PLAUSIBLE_EUR_USD_MAX", originalFxMax);
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2026-05-19">
      <Cube currency="USD" rate="1.0834"/>
      <Cube currency="JPY" rate="166.32"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe("parseEcbFeed", () => {
  it("extracts USD rate and date from the daily feed", () => {
    expect(parseEcbFeed(SAMPLE_XML)).toEqual({ rateDate: "2026-05-19", eurUsdRate: 1.0834 });
  });

  it("extracts USD rate from the feed with single-quoted attributes (forma reala ECB)", () => {
    // Regresie 2026-07-07: feed-ul live ECB foloseste apostrofuri, nu ghilimele
    // duble — parserul intorcea null => fx.refresh.fail reason=parse_failed
    // => "EUR indisponibil" permanent in UI.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<Cube>
\t\t<Cube time='2026-07-06'>
\t\t\t<Cube currency='USD' rate='1.1415'/>
\t\t\t<Cube currency='JPY' rate='185.31'/>
\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`;
    expect(parseEcbFeed(xml)).toEqual({ rateDate: "2026-07-06", eurUsdRate: 1.1415 });
  });

  it("returns null when attribute quotes are mismatched (not a valid pair)", () => {
    // Regresie: regex-ul ["']...["'] accepta azi ghilimele NEPERECHE
    // (ex. time="2026-07-06') — trebuie sa ceara acelasi delimitator la
    // deschidere si inchidere (backreference).
    const xml = `<Cube><Cube time="2026-07-06'><Cube currency="USD" rate="1.08"/></Cube></Cube>`;
    expect(parseEcbFeed(xml)).toBeNull();
  });

  it("returns null when USD is missing", () => {
    const xml = `<Cube><Cube time="2026-05-19"><Cube currency="JPY" rate="166.32"/></Cube></Cube>`;
    expect(parseEcbFeed(xml)).toBeNull();
  });

  it("returns null when the date is missing", () => {
    const xml = `<Cube><Cube><Cube currency="USD" rate="1.08"/></Cube></Cube>`;
    expect(parseEcbFeed(xml)).toBeNull();
  });

  it("returns null on garbage input", () => {
    expect(parseEcbFeed("")).toBeNull();
    expect(parseEcbFeed("<html>not xml</html>")).toBeNull();
  });
});

describe("computeUsdToEur", () => {
  it("inverts EUR/USD into USD/EUR rounded to 6 decimals", () => {
    expect(computeUsdToEur(1.0834)).toBeCloseTo(0.92302, 5);
  });
});

describe("fetchEcbDailyRates", () => {
  it("upserts the latest USD/EUR rate when the feed is well-formed", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SAMPLE_XML,
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toMatchObject({ ok: true, pair: "USD/EUR", rateDate: "2026-05-19" });
    expect(result.rate).toBeCloseTo(0.92302, 5);
    const stored = getLatest("USD/EUR");
    expect(stored?.rate_date).toBe("2026-05-19");
    expect(stored?.source).toBe("ecb");
  });

  it("returns ok:false with http_status on non-200", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toEqual({ ok: false, reason: "http_503" });
    expect(getLatest("USD/EUR")).toBeNull();
  });

  it("returns ok:false on parse failure (no USD)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `<Cube><Cube time="2026-05-19"><Cube currency="JPY" rate="166"/></Cube></Cube>`,
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toEqual({ ok: false, reason: "parse_failed" });
  });

  it("fails closed on implausible ECB rates", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SAMPLE_XML.replace('rate="1.0834"', 'rate="2.5000"'),
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toEqual({ ok: false, reason: "implausible_rate", observedRate: 2.5 });
    expect(getLatest("USD/EUR")).toBeNull();
  });

  // FIX #9 (v2.33.0 follow-up — MEDIUM-11 low-bound coverage): plausibility
  // band must fail-closed on BOTH directions. High-bound (2.5) was already
  // covered above; without this low-bound test, a regressing operator override
  // (FX_PLAUSIBLE_EUR_USD_MIN set < 0 or a parser bug emitting rate=0) could
  // slip through. D14 invariant: never fabricate a fallback EUR rate.
  it("fails closed on implausibly low ECB rates (below band.min)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SAMPLE_XML.replace('rate="1.0834"', 'rate="0.0001"'),
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toEqual({ ok: false, reason: "implausible_rate", observedRate: 0.0001 });
    expect(getLatest("USD/EUR")).toBeNull();
  });

  it("allows operator override of the plausibility band without manual FX entry", async () => {
    process.env.FX_PLAUSIBLE_EUR_USD_MAX = "3";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => SAMPLE_XML.replace('rate="1.0834"', 'rate="2.5000"'),
    })) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result).toMatchObject({ ok: true, pair: "USD/EUR", rateDate: "2026-05-19" });
  });

  it("returns ok:false on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    const result = await fetchEcbDailyRates({ fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ENOTFOUND");
  });
});
