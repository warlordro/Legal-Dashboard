import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { openapiRouter } from "./openapi.ts";

function app() {
  const a = new Hono();
  a.route("/api/v1/openapi.json", openapiRouter);
  return a;
}

describe("openapi.json", () => {
  it("serves a valid OpenAPI 3.1 spec (application/json)", async () => {
    const res = await app().request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: { bearerAuth: { scheme: string } } };
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });

  it("documents the correct method per route (ICCJ = GET, RNPM search = POST)", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/api/dosare"]?.get).toBeDefined();
    expect(spec.paths["/api/dosare-iccj"]?.get).toBeDefined();
    expect(spec.paths["/api/dosare-iccj"]?.post).toBeUndefined();
    expect(spec.paths["/api/rnpm/search"]?.post).toBeDefined();
    // token management routes are documented too
    expect(spec.paths["/api/v1/tokens"]).toBeDefined();
  });

  it("documents all query params the /api/dosare route accepts (institutie, dataStart, dataStop)", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>;
    };
    const names = (spec.paths["/api/dosare"]?.get?.parameters ?? []).map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["numarDosar", "numeParte", "obiectDosar", "institutie", "dataStart", "dataStop"])
    );
  });

  // Specul e singurul loc unde un integrator vede campurile FARA sa citeasca un
  // document: intr-un vizualizator (Swagger UI, Postman, generator de client)
  // schema de mai jos devine formular. Pana la v2.46.0 ruta de cautare nu avea
  // corpul descris deloc, deci `includeDetails` si filtrele pe rol erau
  // invizibile acolo.
  describe("corpul cererii pe POST /api/rnpm/search", () => {
    async function searchBodySchema() {
      const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
        paths: Record<
          string,
          {
            post?: {
              requestBody?: {
                required?: boolean;
                content: { "application/json": { schema: Record<string, never> } };
              };
            };
          }
        >;
      };
      const body = spec.paths["/api/rnpm/search"]?.post?.requestBody;
      return {
        body,
        schema: body?.content["application/json"].schema as unknown as {
          required?: string[];
          properties: Record<string, { type?: string; enum?: string[]; description?: string; properties?: unknown }>;
        },
      };
    }

    it("descrie corpul ca JSON obligatoriu, cu `type` si `params` cerute", async () => {
      const { body, schema } = await searchBodySchema();
      expect(body?.required).toBe(true);
      expect(schema.required).toEqual(expect.arrayContaining(["type", "params"]));
      expect(schema.properties.type?.enum).toEqual(["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"]);
    });

    it("expune `includeDetails` ca boolean explicat, nu doar in text liber", async () => {
      const { schema } = await searchBodySchema();
      const flag = schema.properties.includeDetails;
      expect(flag?.type).toBe("boolean");
      // Descrierea e ce citeste omul in formular; fara ea bifa nu spune nimic.
      expect(flag?.description).toMatch(/aviz\.id/);
    });

    it("expune filtrele pe rol cu scrierea exacta a cheilor, care nu e uniforma", async () => {
      const { schema } = await searchBodySchema();
      const params = schema.properties.params as { properties?: Record<string, unknown> };
      const keys = Object.keys(params.properties ?? {});
      // Majusculele difera intre roluri; o cheie scrisa gresit e ignorata tacut,
      // deci specul trebuie sa le arate exact asa cum le asteapta registrul.
      expect(keys).toEqual(expect.arrayContaining(["creditorPJ", "CreditorPF", "debitorPJ", "debitorPF"]));
    });

    it('explica operatorul SI/SAU al criteriilor, altfel `type: "1"` e un numar fara sens', async () => {
      const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
        components: { schemas?: Record<string, { properties?: { type?: { enum?: string[]; description?: string } } }> };
      };
      const siSau = spec.components.schemas?.RnpmCriteriu;
      expect(siSau?.properties?.type?.enum).toEqual(["1", "2"]);
      expect(siSau?.properties?.type?.description).toMatch(/SI/);
      expect(siSau?.properties?.type?.description).toMatch(/SAU/);
    });
  });

  it("toate `$ref`-urile din spec au tinta existenta", async () => {
    // Un `$ref` care nu rezolva nu da eroare la generare: campul apare pur si
    // simplu GOL in vizualizator, deci integratorul nu vede criteriile deloc.
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as Record<string, unknown>;
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "$ref" && typeof v === "string") refs.push(v);
        else walk(v);
      }
    };
    walk(spec);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = ref.replace(/^#\//, "").split("/");
      let cursor: unknown = spec;
      for (const seg of target) {
        cursor = (cursor as Record<string, unknown> | undefined)?.[seg];
      }
      expect(cursor, `${ref} nu rezolva`).toBeDefined();
    }
  });

  it("overrides bearer auth with session-cookie auth on token-management routes", async () => {
    const spec = (await (await app().request("/api/v1/openapi.json")).json()) as {
      components: { securitySchemes: Record<string, unknown> };
      paths: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>;
    };
    expect(spec.components.securitySchemes.sessionCookie).toBeDefined();
    expect(spec.paths["/api/v1/tokens"].post.security).toEqual([{ sessionCookie: [] }]);
    expect(spec.paths["/api/v1/tokens/revoke-all"].post.security).toEqual([{ sessionCookie: [] }]);
  });
});
