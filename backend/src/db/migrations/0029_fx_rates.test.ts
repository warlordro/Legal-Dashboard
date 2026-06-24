import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0029_fx_rates", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  function readSql(name: string): string {
    return readFileSync(resolve(__dirname, name), "utf8");
  }

  it("UP creeaza tabela cu source default 'ecb'", () => {
    db.exec(readSql("0029_fx_rates.up.sql"));
    db.prepare("INSERT INTO fx_rates (pair, rate, rate_date) VALUES (?, ?, ?)").run("USD/EUR", 0.92, "2026-05-19");
    const row = db.prepare("SELECT pair, rate, rate_date, source FROM fx_rates").get() as {
      pair: string;
      rate: number;
      rate_date: string;
      source: string;
    };
    expect(row.source).toBe("ecb");
  });

  it("UP CHECK refuza rate <= 0", () => {
    db.exec(readSql("0029_fx_rates.up.sql"));
    expect(() =>
      db.prepare("INSERT INTO fx_rates (pair, rate, rate_date) VALUES (?, ?, ?)").run("USD/EUR", 0, "2026-05-19")
    ).toThrow(/CHECK constraint/i);
  });

  it("UP PRIMARY KEY (pair, rate_date) refuza duplicate", () => {
    db.exec(readSql("0029_fx_rates.up.sql"));
    db.prepare("INSERT INTO fx_rates (pair, rate, rate_date) VALUES (?, ?, ?)").run("USD/EUR", 0.92, "2026-05-19");
    expect(() =>
      db.prepare("INSERT INTO fx_rates (pair, rate, rate_date) VALUES (?, ?, ?)").run("USD/EUR", 0.93, "2026-05-19")
    ).toThrow(/UNIQUE constraint|PRIMARY KEY/i);
  });

  it("UP + DOWN + UP este reversibil", () => {
    db.exec(readSql("0029_fx_rates.up.sql"));
    db.exec(readSql("0029_fx_rates.down.sql"));
    const dropped = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fx_rates'").get();
    expect(dropped).toBeUndefined();
    expect(() => db.exec(readSql("0029_fx_rates.up.sql"))).not.toThrow();
  });
});
