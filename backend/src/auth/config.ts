export type AuthMode = "desktop" | "web";

const WEB_SECRET_MIN_LENGTH = 32;

function readMode(raw: string | undefined): AuthMode {
  const mode = (raw ?? "desktop").trim().toLowerCase();
  if (mode === "desktop" || mode === "web") return mode;
  throw new Error(
    `Invalid LEGAL_DASHBOARD_AUTH_MODE/APP_MODE: ${raw}. Expected "desktop" or "web".`,
  );
}

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  return readMode(env.LEGAL_DASHBOARD_AUTH_MODE ?? env.APP_MODE);
}

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.LEGAL_DASHBOARD_JWT_SECRET ?? env.JWT_SECRET ?? null;
  if (secret === null || secret.trim() === "") return null;
  return secret;
}

export function getJwtIssuer(env: NodeJS.ProcessEnv = process.env): string | null {
  const issuer = env.LEGAL_DASHBOARD_JWT_ISSUER ?? null;
  return issuer && issuer.trim() !== "" ? issuer : null;
}

export function getJwtAudience(env: NodeJS.ProcessEnv = process.env): string | null {
  const audience = env.LEGAL_DASHBOARD_JWT_AUDIENCE ?? null;
  return audience && audience.trim() !== "" ? audience : null;
}

export function getTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw =
    env.LEGAL_DASHBOARD_JWT_TTL_SECONDS ?? env.LEGAL_DASHBOARD_AUTH_TOKEN_TTL_SECONDS;
  if (!raw) return 60 * 60;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 24 * 60 * 60) {
    throw new Error(
      "LEGAL_DASHBOARD_JWT_TTL_SECONDS must be between 60 and 86400 seconds.",
    );
  }
  return Math.floor(parsed);
}

export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = getJwtSecret(env);
  if (!secret || secret.length < WEB_SECRET_MIN_LENGTH) {
    throw new Error(
      `LEGAL_DASHBOARD_JWT_SECRET must be set and at least ${WEB_SECRET_MIN_LENGTH} characters when auth mode is web.`,
    );
  }
  return secret;
}

export function validateAuthConfig(env: NodeJS.ProcessEnv = process.env): void {
  const mode = getAuthMode(env);
  if (mode === "web") {
    requireJwtSecret(env);
    getTokenTtlSeconds(env);
  }
}
