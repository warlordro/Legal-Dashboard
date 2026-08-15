import { Hono } from "hono";
import { PAT_CAPABILITIES } from "../middleware/patCapabilityGate.ts";

// OpenAPI 3.1 pentru suprafata PAT (piesa A). Generat din PAT_CAPABILITIES (single source)
// ca sa nu diverge de gate. Discovery: montat INAINTE de gate (Task 16), deci un PAT isi
// poate citi propriul spec fara 403.
export const openapiRouter = new Hono();

const SCOPE_SUMMARY: Record<string, string> = {
  dosare: "Cautare dosare + termene PortalJust (doar citire).",
  iccj: "Cautare dosare + termene ICCJ / scj.ro (doar citire).",
  rnpm: "Cautare + listare RNPM (doar citire; scope rnpm necesita cheie captcha tenant).",
};

// Parametri de paginare PER ENDPOINT (PAT-008): NU un `page` generic.
function paramsFor(prefix: string): unknown[] {
  if (prefix === "/api/dosare-iccj" || prefix === "/api/termene-iccj") {
    return [
      { name: "numarDosar", in: "query", schema: { type: "string" } },
      { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 20 } },
    ];
  }
  if (prefix === "/api/rnpm/saved") {
    return [
      { name: "page", in: "query", schema: { type: "integer", minimum: 0 } },
      { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
    ];
  }
  if (prefix === "/api/dosare" || prefix === "/api/termene") {
    return [
      { name: "numarDosar", in: "query", schema: { type: "string" } },
      { name: "numeParte", in: "query", schema: { type: "string" } },
      { name: "obiectDosar", in: "query", schema: { type: "string" } },
      { name: "dataStart", in: "query", schema: { type: "string", format: "date" } },
      { name: "dataStop", in: "query", schema: { type: "string", format: "date" } },
      // Repetabil (?institutie=A&institutie=B); ruta citeste c.req.queries("institutie").
      {
        name: "institutie",
        in: "query",
        style: "form",
        explode: true,
        schema: { type: "array", items: { type: "string" } },
      },
    ];
  }
  return [];
}

// Un criteriu de cautare RNPM: valoarea plus operatorul logic fata de celelalte
// criterii. `type` e "1"/"2" pentru ca asa le numeroteaza registrul; fara
// explicatie in spec, un integrator vede un numar fara sens si ghiceste.
const CRITERIU_REF = { $ref: "#/components/schemas/RnpmCriteriu" };

function rnpmCriteriuSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["type", "value"],
    properties: {
      type: {
        type: "string",
        enum: ["1", "2"],
        description: 'Operator fata de celelalte criterii: "1" = SI, "2" = SAU.',
      },
      value: { type: "string", description: "Valoarea cautata." },
    },
  };
}

// Filtrele pe rol. Scrierea cheilor NU e uniforma — e copiata dupa cea a
// registrului: `creditorPJ.regCom` are `r` mic, `debitorPJ.RegCom` are `R` mare,
// `CreditorPF` incepe cu majuscula iar `debitorPF` nu. O cheie scrisa gresit e
// ignorata in tacere (filtrul nu se aplica, raspunsul contine tot), deci specul
// e locul unde integratorul le vede exact, fara sa citeasca documentatia.
function rnpmSearchParamsSchema(): Record<string, unknown> {
  const persoanaJuridica = (regComKey: "regCom" | "RegCom") => ({
    type: "object",
    properties: {
      denumire: { type: "string" },
      [regComKey]: CRITERIU_REF,
      CUI: CRITERIU_REF,
    },
  });
  const persoanaFizica = {
    type: "object",
    properties: {
      nume: { type: "string" },
      prenume: CRITERIU_REF,
      CNP: CRITERIU_REF,
    },
  };
  return {
    type: "object",
    description:
      "Criteriile de cautare. Atentie la scrierea cheilor — nu e uniforma (vine de la registru), " +
      "iar o cheie gresita e ignorata TACIT: filtrul nu se aplica si raspunsul contine tot.",
    properties: {
      creditorPJ: persoanaJuridica("regCom"),
      CreditorPF: persoanaFizica,
      debitorPJ: persoanaJuridica("RegCom"),
      debitorPF: persoanaFizica,
      tipInscriere: CRITERIU_REF,
      perioadaStart: { type: "string", description: "Format zz.ll.aaaa." },
      perioadaFinal: { type: "string", description: "Format zz.ll.aaaa." },
      activ: { type: "boolean" },
    },
  };
}

function rnpmSearchRequestBody(): Record<string, unknown> {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["type", "params"],
          properties: {
            type: {
              type: "string",
              enum: ["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"],
              description: "Tipul de inscriere cautat.",
            },
            params: rnpmSearchParamsSchema(),
            includeDetails: {
              type: "boolean",
              default: false,
              description:
                "Adauga `details[]` = avizele complete, in aceeasi forma ca `GET /api/rnpm/saved/{id}`. " +
                "Coreleaza-le pe `aviz.id` contra valorilor din `avizIds`, NU pe pozitie: fiecare aviz apare " +
                "o singura data in `details`, desi poate aparea de doua ori in `avizIds`. Nu costa nicio " +
                "captcha in plus. Doar `true` boolean activeaza campul.",
            },
            startRnpmPage: {
              type: "integer",
              minimum: 1,
              maximum: 500,
              default: 1,
              description: "Pagina de start; continua de la `nextRnpmPage` din raspunsul precedent.",
            },
            batchSize: {
              type: "integer",
              minimum: 1,
              maximum: 200,
              default: 25,
              description: "Cate avize se aduc intr-o cerere.",
            },
            gcode: {
              type: "string",
              description: "Token-ul de sesiune al registrului, din raspunsul precedent. Doar la paginare.",
            },
            searchId: {
              type: "integer",
              description: "Cautarea existenta careia i se adauga paginile. Doar la paginare.",
            },
          },
        },
      },
    },
  };
}

function operationFor(method: string, prefix: string, scope: string): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: SCOPE_SUMMARY[scope] ?? prefix,
    tags: [scope],
    security: [{ bearerAuth: [] }],
    responses: {
      "200": { description: "OK" },
      "401": { description: "invalid_token (lowercase, via AuthenticationError)" },
      "403": { description: "PAT_ROUTE_FORBIDDEN / INSUFFICIENT_SCOPE" },
      // CodeRabbit 21: rutele chiar raspund 413 la depasirea limitei de body
      // (bodyLimit global + limitele per-ruta), dar specul nu il documenta.
      "413": { description: "PAYLOAD_TOO_LARGE (body peste limita rutei)" },
      "429": { description: "rate_limited / QUOTA_EXCEEDED (Retry-After)" },
      "503": { description: "ICCJ_UNAVAILABLE (breaker) / captcha reservation retry" },
    },
  };
  if (method === "GET") {
    const params = paramsFor(prefix);
    if (params.length > 0) op.parameters = params;
  }
  if (prefix === "/api/dosare") {
    op.description =
      "Raspuns imbogatit: `exactMatch` (boolean, DOAR pe numar dosar) + `parti[].calitateParte`. Forma legacy `{ data, total, exactMatch }`. Optional `failedInstitutii: string[]` = raspuns 200 cu rezultate PARTIALE (instantele listate nu au raspuns, dosarele lor lipsesc; inainte de v2.43.1 acest caz era eroare 500).";
  }
  if (prefix === "/api/rnpm/search") {
    op.requestBody = rnpmSearchRequestBody();
    op.description =
      "Cautare RNPM dupa rol debitor/creditor; paginare prin `startRnpmPage` (body) -> `nextRnpmPage`. " +
      "Optional `includeDetails: true` (boolean strict) adauga `details[]` = avizele complete, in aceeasi " +
      "forma ca `GET /api/rnpm/saved/{id}`; fara camp raspunsul ramane neschimbat. Coreleaza pe `aviz.id` " +
      "contra `avizIds`, NU pe pozitie: fiecare aviz apare o singura data in `details`, desi poate aparea " +
      "de doua ori in `avizIds`. Avizele fara detalii aduse lipsesc din `details` si apar in `detailsFailed`. " +
      "Daca citirea detaliilor esueaza, `details` lipseste din raspuns, restul campurilor raman intacte.";
  }
  return op;
}

function tokenManagementPaths(): Record<string, Record<string, unknown>> {
  // F12-F8 (2026-07-26): rutele cer si rol admin (requireRole in apiTokens.ts). Fara
  // mentiunea asta specul ar sugera ca orice sesiune poate emite tokenuri.
  const sessionNote =
    "Session-only (cookie/JWT) SI doar rol admin (403 forbidden altfel). Un PAT primeste 403 PAT_CANNOT_MANAGE_TOKENS.";
  // Override-uieste security-ul global bearerAuth (CodeRabbit): rutele de management NU accepta
  // un PAT (Bearer) — se autentifica DOAR prin sesiune (cookie). Altfel specul ar sugera gresit
  // ca un PAT poate crea/revoca tokenuri.
  const sessionAuth = [{ sessionCookie: [] }];
  return {
    "/api/v1/tokens": {
      post: {
        summary: "Creeaza un PAT. Secretul e afisat O SINGURA DATA.",
        description: sessionNote,
        tags: ["tokens"],
        security: sessionAuth,
      },
      get: {
        summary: "Listeaza tokenurile owner-ului (fara secret/hash).",
        description: sessionNote,
        tags: ["tokens"],
        security: sessionAuth,
      },
    },
    "/api/v1/tokens/{id}": {
      delete: {
        summary: "Revoca un token (idempotent).",
        description: sessionNote,
        tags: ["tokens"],
        security: sessionAuth,
      },
    },
    "/api/v1/tokens/revoke-all": {
      post: {
        summary: "Revoca toate tokenurile active ale owner-ului.",
        description: sessionNote,
        tags: ["tokens"],
        security: sessionAuth,
      },
    },
  };
}

export function buildOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const cap of PAT_CAPABILITIES) {
    paths[cap.prefix] = paths[cap.prefix] ?? {};
    paths[cap.prefix][cap.method.toLowerCase()] = operationFor(cap.method, cap.prefix, cap.scope);
  }
  Object.assign(paths, tokenManagementPaths());
  return {
    openapi: "3.1.0",
    info: {
      title: "Legal Dashboard API (Personal Access Token)",
      version: "1.0.0",
      description:
        "Suprafata programatica doar-citire pentru dosare/ICCJ/RNPM via PAT opac (`ld_pat_*`). HTTPS-only in productie. Vezi API.md pentru forme de raspuns per ruta.",
    },
    servers: [{ url: "/", description: "Same-origin (web mode)" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Authorization: Bearer ld_pat_..." },
        // Rutele de management tokenuri (/api/v1/tokens*) se autentifica prin sesiune, nu PAT.
        sessionCookie: { type: "apiKey", in: "cookie", name: "legal_dashboard_session" },
      },
      schemas: {
        RnpmCriteriu: rnpmCriteriuSchema(),
      },
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

openapiRouter.get("/", (c) => c.json(buildOpenApiSpec()));
