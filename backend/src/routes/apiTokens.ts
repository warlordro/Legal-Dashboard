import { Hono } from "hono";
import { z } from "zod";
import { getOwnerId } from "../middleware/owner.ts";
import { ErrorCodes, fail, ok } from "../util/envelope.ts";
import {
  createApiToken,
  listTokensByOwner,
  revokeAllTokens,
  revokeToken,
  tokenExistsForOwner,
} from "../db/apiTokenRepository.ts";
import { recordAudit } from "../db/auditRepository.ts";

export const apiTokensRouter = new Hono();

// Session-only: un PAT NU poate crea/lista/revoca tokenuri (anti-escaladare).
// Belt-and-suspenders peste gate-ul global (care emite acelasi cod pe /api/v1/tokens).
apiTokensRouter.use("*", async (c, next) => {
  // Raspunsurile de management contin date sensibile one-time (secretul la creare, prefixe +
  // ultima folosire la listare) -> nu se cacheaza de intermediari/browser (CodeRabbit). patSecurity
  // pune no-store doar pe calea PAT; aici caile sunt de sesiune, deci il setam explicit aici.
  c.header("Cache-Control", "no-store");
  if (c.get("tokenId")) {
    return c.json(fail(ErrorCodes.PAT_CANNOT_MANAGE_TOKENS, "Un token nu poate administra tokenuri.", c), 403);
  }
  await next();
});

const SCOPES = ["dosare", "iccj", "rnpm"] as const;
// .strict() respinge campuri necunoscute; name trim + charset afisabil (fara control chars).
const createSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N} ._@()\-]+$/u, "caractere invalide in nume"),
    scopes: z
      .array(z.enum(SCOPES))
      .nonempty()
      .refine((a) => new Set(a).size === a.length, "duplicate scopes"),
    captchaDailyCap: z.number().int().min(0).max(100_000).nullable().optional(),
    expiresInDays: z
      .union([z.literal(30), z.literal(90), z.literal(365)])
      .nullable()
      .optional(),
  })
  .strict();

// PAT-007: plafonul per-token nu poate depasi maximul tenantului. tenantMax din
// env MAX_TOKEN_CAPTCHA_CAP (default 100000).
function tenantMaxCaptchaCap(): number {
  const raw = Number(process.env.MAX_TOKEN_CAPTCHA_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : 100_000;
}

function expiresAtFromDays(days: number | null | undefined): string | null {
  if (!days) return null;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

apiTokensRouter.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail(ErrorCodes.VALIDATION_ERROR, "Date invalide.", c, parsed.error.issues), 400);
  }
  // PAT-007: plafonul cerut nu poate depasi maximul tenantului (check runtime).
  if (parsed.data.captchaDailyCap != null && parsed.data.captchaDailyCap > tenantMaxCaptchaCap()) {
    return c.json(
      fail(ErrorCodes.VALIDATION_ERROR, `captchaDailyCap depaseste maximul (${tenantMaxCaptchaCap()}).`, c),
      422
    );
  }
  const ownerId = getOwnerId(c);
  const { row, secret } = createApiToken({
    ownerId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    captchaDailyCap: parsed.data.captchaDailyCap ?? null,
    expiresAt: expiresAtFromDays(parsed.data.expiresInDays),
  });
  recordAudit(c, "api_token.created", {
    outcome: "ok",
    targetKind: "api_token",
    targetId: row.id,
    detail: { scopes: parsed.data.scopes },
  });
  return c.json(
    ok(
      {
        id: row.id,
        name: row.name,
        scopes: parsed.data.scopes,
        tokenPrefix: row.token_prefix,
        captchaDailyCap: row.captcha_daily_cap,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        secret, // afisat O SINGURA DATA
      },
      c
    ),
    201
  );
});

apiTokensRouter.get("/", (c) => {
  const rows = listTokensByOwner(getOwnerId(c)).map((r) => ({
    id: r.id,
    name: r.name,
    scopes: r.scopes.split(",").filter(Boolean),
    tokenPrefix: r.token_prefix,
    captchaDailyCap: r.captcha_daily_cap,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    lastUsedIp: r.last_used_ip,
    revokedAt: r.revoked_at,
  }));
  return c.json(ok(rows, c), 200);
});

apiTokensRouter.delete("/:id", (c) => {
  const ownerId = getOwnerId(c);
  const id = c.req.param("id");
  if (revokeToken(ownerId, id)) {
    recordAudit(c, "api_token.revoked", { outcome: "ok", targetKind: "api_token", targetId: id });
    return c.json(ok({ revoked: true }, c), 200);
  }
  // DELETE idempotent (PAT-009): token existent dar deja revocat -> 200; doar cel
  // cu adevarat inexistent (sau al altui owner) -> 404.
  if (tokenExistsForOwner(ownerId, id)) {
    return c.json(ok({ revoked: true, alreadyRevoked: true }, c), 200);
  }
  return c.json(fail(ErrorCodes.NOT_FOUND, "Token inexistent.", c), 404);
});

apiTokensRouter.post("/revoke-all", (c) => {
  const ownerId = getOwnerId(c);
  const count = revokeAllTokens(ownerId);
  recordAudit(c, "api_token.revoked_all", { outcome: "ok", targetKind: "api_token", detail: { count } });
  return c.json(ok({ revoked: count }, c), 200);
});
