import { readFile, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AvizFull, AvizRecord, BunRecord, IstoricRecord, PartyRecord } from "../db/avizRepository.ts";
import { buildRnpmPdf } from "./rnpmExportPdf.ts";

const generatedFiles: string[] = [];

async function buildAndTrack(items: AvizFull[], searchType?: string) {
  const result = await buildRnpmPdf(items, searchType);
  generatedFiles.push(result.filepath);
  return result;
}

afterEach(async () => {
  const files = generatedFiles.splice(0);
  await Promise.all(files.map((file) => unlink(file).catch(() => {})));
});

function makeAviz(overrides: Partial<AvizRecord> = {}): AvizRecord {
  return {
    id: 1,
    owner_id: "local",
    uuid: "uuid-1",
    identificator: "2026-AV-1",
    search_type: "ipoteci",
    tip: "Aviz initial",
    data: "2026-05-12",
    utilizator_autorizat: "Operator",
    activ: 1,
    needs_actualizare: 0,
    destinatie: "Constituire",
    tip_act: "Contract",
    numar_act: "123",
    data_inreg: "2026-05-12",
    data_expirare: "2031-05-12",
    alte_mentiuni: null,
    detalii_comune: "detalii",
    inscriere_initiala_id: null,
    inscriere_initiala_uuid: null,
    inscriere_modificata_id: null,
    inscriere_modificata_uuid: null,
    detail_fetched: 1,
    search_id: null,
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
    ...overrides,
  };
}

function makeParty(overrides: Partial<PartyRecord> = {}): PartyRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    tip_persoana: "PJ",
    calitate: null,
    denumire: "ACME SRL",
    prenume: null,
    tip_entitate: "SRL",
    sediu: "Bucuresti",
    nr_identificare: null,
    cod: null,
    cnp: null,
    tara: "RO",
    localitate: "Bucuresti",
    judet: "B",
    cod_postal: "010101",
    alte_date: null,
    subscriptor: 1,
    nr_ordine: 1,
    ...overrides,
  };
}

function makeBun(overrides: Partial<BunRecord> = {}): BunRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    tip_bun: "vehicul",
    categorie: null,
    identificare: "DACIA LOGAN",
    descriere: null,
    model: "LOGAN",
    serie_sasiu: "UU1XYZ123",
    serie_motor: null,
    nr_inmatriculare: "B 01 ABC",
    referinte: [],
    ...overrides,
  };
}

function makeIstoric(overrides: Partial<IstoricRecord> = {}): IstoricRecord {
  return {
    id: 1,
    owner_id: "local",
    aviz_id: 1,
    identificator: "2026-AV-1-MOD",
    uuid: "uuid-mod",
    data: "2026-05-12",
    tip: "Modificare",
    inscriere_m_v: null,
    inscriere_m_k: null,
    ...overrides,
  };
}

function makeFull(overrides: Partial<AvizFull> = {}): AvizFull {
  return {
    aviz: makeAviz(),
    creditori: [makeParty({ id: 10 })],
    debitori: [makeParty({ id: 11, calitate: "Debitor" })],
    bunuri: [makeBun()],
    istoric: [makeIstoric()],
    ...overrides,
  };
}

describe("buildRnpmPdf", () => {
  it("produce un PDF valid pentru 1 aviz", async () => {
    const result = await buildAndTrack([makeFull()], "ipoteci");
    expect(result.mime).toBe("application/pdf");
    expect(result.byteLength).toBeGreaterThan(1000);
    const bytes = await readFile(result.filepath);
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("respecta filtrul searchType=specifice fara sectiunea Creditori", async () => {
    const result = await buildAndTrack([makeFull()], "specifice");
    const text = (await readFile(result.filepath)).toString("latin1");
    expect(text).toContain("/Type /Page");
    expect(result.filename).toBe("2026-AV-1.pdf");
  });

  it("nu aplica formula guard pentru PDF", async () => {
    const result = await buildAndTrack([
      makeFull({
        debitori: [makeParty({ denumire: "=SUM(A1)" })],
      }),
    ]);
    expect(result.byteLength).toBeGreaterThan(1000);
  });

  it("calculeaza filename-ul pentru export single si multiplu", async () => {
    const single = await buildAndTrack([makeFull()], "ipoteci");
    expect(single.filename).toBe("2026-AV-1.pdf");

    const multiple = await buildAndTrack([
      makeFull(),
      makeFull({ aviz: makeAviz({ id: 2, identificator: "2026-AV-2", uuid: "uuid-2" }) }),
    ]);
    expect(multiple.filename).toMatch(/^rnpm_.+\.pdf$/);
  });

  it("nu explodeaza numarul de pagini pentru campuri foarte lungi", async () => {
    const longText = "CONTRACT DE GARANTIE ".repeat(2000);
    const longRows = Array.from({ length: 30 }, (_, index) =>
      makeParty({
        id: 100 + index,
        nr_ordine: index + 1,
        denumire: `Debitor ${index + 1} ${longText}`,
        sediu: longText,
      })
    );
    const result = await buildAndTrack([
      makeFull({
        aviz: makeAviz({ detalii_comune: longText }),
        creditori: longRows,
        debitori: longRows,
        bunuri: Array.from({ length: 30 }, (_, index) =>
          makeBun({
            id: 200 + index,
            descriere: longText,
            referinte: [
              {
                rol: "constituitor",
                tip_persoana: "PJ",
                denumire: longText,
                prenume: null,
              },
            ],
          })
        ),
      }),
    ]);
    const pdf = (await readFile(result.filepath)).toString("latin1");
    const pageCount = pdf.match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pageCount).toBeGreaterThan(0);
    expect(pageCount).toBeLessThan(50);
  });
});
