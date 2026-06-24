import { describe, it, expect } from "vitest";
import { formatIsoDateTime, formatCadence } from "./datetime-formatters";

// Caracterizeaza comportamentul consolidat din Stage 5: 5 pagini (Alerts,
// Audit, Quota, Users, Monitorizare) aveau definitii locale aproape identice
// pentru formatDateTime + 1 pagina (Monitorizare) avea formatCadence. Pastram
// regulile vechi: nullable -> "-", invalid -> echo input raw, ro-RO locale,
// `seconds: true` opt-in pentru audit.

describe("formatIsoDateTime", () => {
  it("returneaza '-' pentru null", () => {
    expect(formatIsoDateTime(null)).toBe("-");
  });

  it("returneaza '-' pentru undefined", () => {
    expect(formatIsoDateTime(undefined)).toBe("-");
  });

  it("returneaza '-' pentru sirul gol", () => {
    expect(formatIsoDateTime("")).toBe("-");
  });

  it("echo input pentru data invalida", () => {
    expect(formatIsoDateTime("nu-i o data")).toBe("nu-i o data");
  });

  it("formateaza ISO valid in stilul ro-RO scurt (fara secunde implicit)", () => {
    const out = formatIsoDateTime("2026-04-30T08:30:45.000Z");
    // Format exact depinde de timezone; verificam structura: dd.MM.yyyy, HH:mm
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  it("include secunde cand opts.seconds = true", () => {
    const out = formatIsoDateTime("2026-04-30T08:30:45.000Z", { seconds: true });
    expect(out).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/);
  });
});

describe("formatCadence", () => {
  it("zile cand sec >= 86400", () => {
    expect(formatCadence(86400)).toBe("1z");
    expect(formatCadence(86400 * 7)).toBe("7z");
  });

  it("ore cand sec >= 3600 si < 86400", () => {
    expect(formatCadence(3600)).toBe("1h");
    expect(formatCadence(14400)).toBe("4h");
    expect(formatCadence(86399)).toBe("24h");
  });

  it("minute cand sec < 3600", () => {
    expect(formatCadence(60)).toBe("1min");
    expect(formatCadence(600)).toBe("10min");
    expect(formatCadence(3599)).toBe("60min");
  });
});
