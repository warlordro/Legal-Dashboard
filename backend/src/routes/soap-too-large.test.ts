// Regression test: SOAP response > cap propaga catre route handlers ca
// SoapResponseTooLargeError si trebuie sa devina HTTP 413 cu mesaj actionable,
// NU 500 cu "Incercati din nou.". Vezi v2.27.1: cautarea "AUTO IN SRL" facea
// upstream sa intoarca ~17MB peste cap-ul de 8MB; dupa bump la 50MB si typed
// error, cazul ramane reproducibil daca PortalJust intoarce >50MB.

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../soap.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../soap.ts")>();
  return {
    ...actual,
    cautareDosare: vi.fn(),
  };
});

import { requestIdContext } from "../middleware/requestId.ts";
import { cautareDosare, SoapResponseTooLargeError } from "../soap.ts";
import { allInstitutionTokens } from "../util/institutionLabel.ts";
import { dosareRouter } from "./dosare.ts";
import { termeneRouter } from "./termene.ts";

const mockedCautare = cautareDosare as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedCautare.mockReset();
});

function buildApp() {
  const app = new Hono();
  app.use("*", requestIdContext);
  app.route("/api/dosare", dosareRouter);
  app.route("/api/termene", termeneRouter);
  return app;
}

describe("SoapResponseTooLargeError -> HTTP 413 actionable", () => {
  it("GET /api/dosare returneaza 413 + mesaj 'Restrange filtrele' cand SOAP body > cap", async () => {
    mockedCautare.mockRejectedValueOnce(new SoapResponseTooLargeError(60 * 1024 * 1024));

    const res = await buildApp().request("/api/dosare?numeParte=AUTO+IN+SRL");

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Restrange filtrele/i);
    expect(body.error).toMatch(/interval de date|institutie|nume mai specific/i);
    // Mesajul NU trebuie sa fie "Incercati din nou" — query-ul e determinist.
    expect(body.error).not.toMatch(/Incercati din nou/i);
  });

  it("GET /api/dosare ramane 500 generic pentru alte erori SOAP (network, fault)", async () => {
    // Esec PERSISTENT (nu Once): pe cautarea fara filtru, apelul agregat esuat
    // declanseaza fallback-ul per instanta pe tot catalogul. Cu toate instantele
    // picate, ruta ramane 500 generic — dar asertam explicit call count-ul ca sa
    // nu fie fals-verde care mascheaza fanout-ul (un Once ar lasa restul apelurilor
    // sa se rezolve undefined si tot ar da 500, din alt motiv).
    mockedCautare.mockRejectedValue(new Error("Eroare la comunicarea cu serviciul PortalJust."));

    const res = await buildApp().request("/api/dosare?numeParte=POPESCU");

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Incercati din nou/i);
    expect(mockedCautare).toHaveBeenCalledTimes(1 + allInstitutionTokens().length);
  });

  it("GET /api/termene returneaza 413 + envelope PAYLOAD_TOO_LARGE cand SOAP body > cap", async () => {
    mockedCautare.mockRejectedValueOnce(new SoapResponseTooLargeError(60 * 1024 * 1024));

    const res = await buildApp().request("/api/termene?numeParte=AUTO+IN+SRL");

    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      data: null;
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body).toMatchObject({
      data: null,
      error: { code: "PAYLOAD_TOO_LARGE", message: expect.any(String) },
      requestId: expect.any(String),
    });
    expect(body.error.message).toMatch(/Restrange filtrele/i);
    expect(body.error.message).not.toMatch(/Incercati din nou/i);
  });

  it("GET /api/termene ramane 500 generic (envelope INTERNAL_ERROR) pentru alte erori SOAP", async () => {
    mockedCautare.mockRejectedValueOnce(new Error("Eroare la comunicarea cu serviciul PortalJust."));

    const res = await buildApp().request("/api/termene?numeParte=POPESCU");

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toMatch(/Incercati din nou/i);
  });
});
