import { afterEach, describe, expect, it, vi } from "vitest";
import { cautareDosare, decodeXmlEntities, extractAll, extractFirst, parseDosar, toLegacyDiacritics } from "./soap.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toLegacyDiacritics", () => {
  it("converts modern Romanian comma-below to cedilla", () => {
    expect(toLegacyDiacritics("Țara mea Ș")).toBe("\u0162ara mea \u015E");
    expect(toLegacyDiacritics("șț")).toBe("\u015F\u0163");
  });

  it("leaves ASCII and other characters untouched", () => {
    expect(toLegacyDiacritics("Popescu Ion 2024")).toBe("Popescu Ion 2024");
  });
});

describe("SOAP response cap", () => {
  it("arunca eroare generica si logheaza cand Content-Length depaseste 8MB", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<soap:Envelope/>", {
        status: 200,
        headers: { "content-length": String(10 * 1024 * 1024) },
      })
    );

    await expect(cautareDosare({ numarDosar: "1/1/2024" })).rejects.toThrow(
      "Eroare la comunicarea cu serviciul PortalJust."
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SOAP response prea mare"));
  });

  it("arunca eroare generica si logheaza cand body-ul real depaseste 8MB fara Content-Length", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(9 * 1024 * 1024), {
        status: 200,
      })
    );

    await expect(cautareDosare({ numeParte: "POPESCU" })).rejects.toThrow(
      "Eroare la comunicarea cu serviciul PortalJust."
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SOAP response prea mare (post-read)"));
  });
});

describe("extractFirst / extractAll", () => {
  it("extracts the first matching tag content", () => {
    expect(extractFirst("<a><b>hello</b><b>world</b></a>", "b")).toBe("hello");
  });

  it("returns empty string when tag missing", () => {
    expect(extractFirst("<a></a>", "b")).toBe("");
  });

  it("ignores self-closing tags", () => {
    // self-closing should not match — extractFirst should fall through to the real tag
    expect(extractFirst("<a><b/><b>real</b></a>", "b")).toBe("real");
  });

  it("matches namespaced tags (e.g. soap:Body)", () => {
    expect(extractFirst("<soap:Body>content</soap:Body>", "Body")).toBe("content");
  });

  it("extracts all matches with extractAll", () => {
    expect(extractAll("<root><x>a</x><x>b</x><x>c</x></root>", "x")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when no matches", () => {
    expect(extractAll("<root></root>", "x")).toEqual([]);
  });

  it("does not match a tag that is a prefix of another", () => {
    // "data" should not match "dataStop" — current regex uses (?=[\s>])
    const xml = "<dataStop>2024-01-01</dataStop>";
    expect(extractFirst(xml, "data")).toBe("");
  });
});

describe("parseDosar", () => {
  const xml = `
    <Dosar>
      <numar>1234/2/2024</numar>
      <data>2024-05-01</data>
      <institutie>Tribunalul Bucuresti</institutie>
      <departament>Sectia I Civila</departament>
      <categorieCazNume>Civil</categorieCazNume>
      <stadiuProcesualNume>Fond</stadiuProcesualNume>
      <obiect>litigiu proprietate</obiect>
      <parti>
        <DosarParte>
          <nume>Popescu Ion</nume>
          <calitateParte>Reclamant</calitateParte>
        </DosarParte>
        <DosarParte>
          <nume>Ionescu Maria</nume>
          <calitateParte>Parat</calitateParte>
        </DosarParte>
      </parti>
      <sedinte>
        <DosarSedinta>
          <complet>C1</complet>
          <data>2024-06-15T00:00:00</data>
          <ora>10:00</ora>
          <solutie>Amanat</solutie>
          <solutieSumar>Pentru lipsa procedurii</solutieSumar>
          <documentSedinta></documentSedinta>
          <numarDocument></numarDocument>
          <dataPronuntare></dataPronuntare>
        </DosarSedinta>
      </sedinte>
    </Dosar>
  `;

  it("extracts top-level fields", () => {
    const d = parseDosar(xml);
    expect(d.numar).toBe("1234/2/2024");
    expect(d.institutie).toBe("Tribunalul Bucuresti");
    expect(d.categorieCaz).toBe("Civil");
    expect(d.stadiuProcesual).toBe("Fond");
    expect(d.obiect).toBe("litigiu proprietate");
  });

  it("parses parti as a list of {nume, calitateParte}", () => {
    const d = parseDosar(xml);
    expect(d.parti).toEqual([
      { nume: "Popescu Ion", calitateParte: "Reclamant" },
      { nume: "Ionescu Maria", calitateParte: "Parat" },
    ]);
  });

  it("parses sedinte and does not leak inner sedinta data into top-level fields", () => {
    const d = parseDosar(xml);
    expect(d.sedinte).toHaveLength(1);
    expect(d.sedinte[0].complet).toBe("C1");
    expect(d.sedinte[0].solutie).toBe("Amanat");
    // Top-level "data" should remain "2024-05-01", NOT the sedinta data
    expect(d.data).toBe("2024-05-01");
  });

  it("falls back to legacy categorieCaz when categorieCazNume is missing", () => {
    const legacy = "<Dosar><categorieCaz>Penal</categorieCaz></Dosar>";
    expect(parseDosar(legacy).categorieCaz).toBe("Penal");
  });

  it("returns empty arrays when parti / sedinte sections are missing", () => {
    const minimal = "<Dosar><numar>X</numar></Dosar>";
    const d = parseDosar(minimal);
    expect(d.parti).toEqual([]);
    expect(d.sedinte).toEqual([]);
  });

  it("decodes XML entities in party names and text fields", () => {
    const withEntities = `
      <Dosar>
        <obiect>Litigiu &quot;comercial&quot; &amp; fiscal</obiect>
        <parti>
          <DosarParte>
            <nume>S.C. X &amp; Co. SRL</nume>
            <calitateParte>Reclamant</calitateParte>
          </DosarParte>
        </parti>
        <sedinte>
          <DosarSedinta>
            <solutie>John&apos;s Pub admis</solutie>
          </DosarSedinta>
        </sedinte>
      </Dosar>`;
    const d = parseDosar(withEntities);
    expect(d.obiect).toBe('Litigiu "comercial" & fiscal');
    expect(d.parti[0].nume).toBe("S.C. X & Co. SRL");
    expect(d.sedinte[0].solutie).toBe("John's Pub admis");
  });
});

describe("decodeXmlEntities", () => {
  it("decodes the five standard named entities", () => {
    expect(decodeXmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeXmlEntities("&lt;x&gt;")).toBe("<x>");
    expect(decodeXmlEntities("&quot;q&quot;")).toBe('"q"');
    expect(decodeXmlEntities("John&apos;s")).toBe("John's");
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeXmlEntities("&#65;&#66;")).toBe("AB");
    expect(decodeXmlEntities("&#x41;&#x42;")).toBe("AB");
    // Romanian cedilla Ș (U+015E)
    expect(decodeXmlEntities("&#350;")).toBe("\u015E");
  });

  it("does not double-decode &amp;lt; → '<'", () => {
    // &amp; decodes last, so "&amp;lt;" must remain "&lt;" (literal text
    // "less-than entity"), not become "<"
    expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves text without entities untouched", () => {
    expect(decodeXmlEntities("Popescu Ionescu 2024")).toBe("Popescu Ionescu 2024");
    expect(decodeXmlEntities("")).toBe("");
  });
});
