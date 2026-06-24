import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cautareDosare,
  decodeXmlEntities,
  extractAll,
  extractFirst,
  parseDosar,
  SOAP_MAX_RESPONSE_BYTES,
  SoapResponseTooLargeError,
  stripSearchDots,
  toLegacyDiacritics,
} from "./soap.ts";

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

describe("stripSearchDots", () => {
  it("strips dots from dotted abbreviations so they match the PortalJust index", () => {
    // The reported case: D.O.O. is indexed as DOO; the dotted query returns 0.
    expect(stripSearchDots("EURO ASFALT D.O.O. SARAJEVO")).toBe("EURO ASFALT DOO SARAJEVO");
    expect(stripSearchDots("S.C. ACME S.R.L.")).toBe("SC ACME SRL");
    expect(stripSearchDots("BANCA TRANSILVANIA S.A.")).toBe("BANCA TRANSILVANIA SA");
  });

  it("leaves dot-free names and empty input untouched", () => {
    expect(stripSearchDots("BANCA TRANSILVANIA SA")).toBe("BANCA TRANSILVANIA SA");
    expect(stripSearchDots("")).toBe("");
  });
});

describe("cautareDosare numeParte normalization (wire)", () => {
  // Regression guard: assert the body actually sent to PortalJust, not just the
  // helper. A future refactor that drops the strip call site inside
  // cautareDosare would still pass a helper-only unit test but break the search.
  it("sends numeParte with dots stripped (D.O.O. -> DOO) on the SOAP wire", async () => {
    let capturedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = String((init as RequestInit | undefined)?.body ?? "");
      return new Response(
        '<?xml version="1.0"?><soap:Envelope><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro"><CautareDosareResult></CautareDosareResult></CautareDosareResponse></soap:Body></soap:Envelope>',
        { status: 200 }
      );
    });

    await cautareDosare({ numeParte: "EURO ASFALT D.O.O. SARAJEVO" });

    expect(capturedBody).toContain("<numeParte>EURO ASFALT DOO SARAJEVO</numeParte>");
    expect(capturedBody).not.toContain("D.O.O.");
  });

  it("does NOT strip dots from numarDosar (scope guard — only numeParte is normalized)", async () => {
    let capturedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = String((init as RequestInit | undefined)?.body ?? "");
      return new Response(
        '<?xml version="1.0"?><soap:Envelope><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro"><CautareDosareResult></CautareDosareResult></CautareDosareResponse></soap:Body></soap:Envelope>',
        { status: 200 }
      );
    });

    await cautareDosare({ numarDosar: "1.2/3/2024" });

    expect(capturedBody).toContain("<numarDosar>1.2/3/2024</numarDosar>");
  });

  it("strips dots AND converts modern diacritics to legacy cedilla on numeParte", async () => {
    let capturedBody = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = String((init as RequestInit | undefined)?.body ?? "");
      return new Response(
        '<?xml version="1.0"?><soap:Envelope><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro"><CautareDosareResult></CautareDosareResult></CautareDosareResponse></soap:Body></soap:Envelope>',
        { status: 200 }
      );
    });

    // "Ș" (modern, U+0218) -> "Ş" (legacy, U+015E); "S.R.L." -> "SRL"
    await cautareDosare({ numeParte: "ȘTEFAN S.R.L." });

    expect(capturedBody).toContain("<numeParte>ŞTEFAN SRL</numeParte>");
  });
});

describe("SOAP response cap", () => {
  // v2.27.1: cap-ul a fost ridicat la 50MB (de la 8MB). PortalJust intoarce
  // empiric ~17MB pentru query-uri largi precum "AUTO IN SRL" (1000 dosare cu
  // parti+sedinte). Cap-ul opreste in continuare un upstream runaway (GB).
  it("cap-ul este expus si configurat la 50MB", () => {
    expect(SOAP_MAX_RESPONSE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("arunca SoapResponseTooLargeError cand Content-Length depaseste cap-ul", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<soap:Envelope/>", {
        status: 200,
        headers: { "content-length": String(SOAP_MAX_RESPONSE_BYTES + 1) },
      })
    );

    await expect(cautareDosare({ numarDosar: "1/1/2024" })).rejects.toBeInstanceOf(SoapResponseTooLargeError);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SOAP response prea mare"));
  });

  it("arunca SoapResponseTooLargeError cand body-ul real depaseste cap-ul fara Content-Length", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("x".repeat(SOAP_MAX_RESPONSE_BYTES + 1), {
        status: 200,
      })
    );

    await expect(cautareDosare({ numeParte: "POPESCU" })).rejects.toBeInstanceOf(SoapResponseTooLargeError);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("SOAP response prea mare"));
  });

  it("eroarea expune code SOAP_RESPONSE_TOO_LARGE + bytes pentru dispatch in route handlers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<soap:Envelope/>", {
        status: 200,
        headers: { "content-length": String(SOAP_MAX_RESPONSE_BYTES + 42) },
      })
    );

    try {
      await cautareDosare({ numarDosar: "1/1/2024" });
      throw new Error("expected SoapResponseTooLargeError");
    } catch (err) {
      expect(err).toBeInstanceOf(SoapResponseTooLargeError);
      const typed = err as SoapResponseTooLargeError;
      expect(typed.code).toBe("SOAP_RESPONSE_TOO_LARGE");
      expect(typed.bytes).toBe(SOAP_MAX_RESPONSE_BYTES + 42);
    }
  });

  it("nu trip-uieste cap-ul pentru raspunsuri normale (~1KB)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><soap:Envelope><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro"><CautareDosareResult></CautareDosareResult></CautareDosareResponse></soap:Body></soap:Envelope>',
        { status: 200 }
      )
    );

    await expect(cautareDosare({ numarDosar: "1/1/2024" })).resolves.toEqual([]);
  });
});

describe("cautareDosare false-empty guard (v2.37.1, review cluster 3)", () => {
  it("arunca pe 200 fara envelope-ul CautareDosareResult (pagina drifted != 0 rezultate)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Mentenanta programata PortalJust</body></html>", { status: 200 })
    );

    await expect(cautareDosare({ numarDosar: "1/2/2026" })).rejects.toThrow(/envelope absent/);
  });

  it("arunca cand bare word CautareDosareResult apare intr-o pagina de eroare non-XML (fara tag)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Error 403: blocked request for CautareDosareResult endpoint</body></html>", {
        status: 200,
      })
    );

    await expect(cautareDosare({ numarDosar: "1/2/2026" })).rejects.toThrow(/envelope absent/);
  });

  it("returneaza [] pe envelope legitim cu rezultat gol (self-closed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<?xml version="1.0"?><soap:Envelope><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro"><CautareDosareResult /></CautareDosareResponse></soap:Body></soap:Envelope>',
        { status: 200 }
      )
    );

    await expect(cautareDosare({ numarDosar: "1/2/2026" })).resolves.toEqual([]);
  });

  it("returneaza [] pe <CautareDosareResponse/> gol fara CautareDosareResult (forma reala 0 rezultate)", async () => {
    // Forma EXACTA verificata live (FANCHET SPEED SRL -> 299 bytes): PortalJust
    // intoarce wrapper-ul Response GOL, fara niciun CautareDosareResult. Guard-ul
    // vechi (pe CautareDosareResult) arunca fals "envelope absent" aici.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CautareDosareResponse xmlns="portalquery.just.ro" /></soap:Body></soap:Envelope>',
        { status: 200 }
      )
    );

    await expect(cautareDosare({ numeParte: "FANCHET SPEED SRL" })).resolves.toEqual([]);
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
