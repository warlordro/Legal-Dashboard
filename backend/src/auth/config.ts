export type AuthMode = "desktop" | "web";

const WEB_SECRET_MIN_LENGTH = 32;

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim() !== "") return value;
  }
  return null;
}

function readMode(raw: string | undefined): AuthMode {
  const mode = (raw ?? "desktop").trim().toLowerCase();
  if (mode === "desktop" || mode === "web") return mode;
  throw new Error(`Invalid LEGAL_DASHBOARD_AUTH_MODE/APP_MODE: ${raw}. Expected "desktop" or "web".`);
}

export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  return readMode(env.LEGAL_DASHBOARD_AUTH_MODE ?? env.APP_MODE);
}

export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return firstNonEmpty(env.LEGAL_DASHBOARD_JWT_SECRET, env.JWT_SECRET);
}

export function getJwtIssuer(env: NodeJS.ProcessEnv = process.env): string | null {
  return firstNonEmpty(env.LEGAL_DASHBOARD_JWT_ISSUER, env.JWT_ISSUER);
}

export function getJwtAudience(env: NodeJS.ProcessEnv = process.env): string | null {
  return firstNonEmpty(env.LEGAL_DASHBOARD_JWT_AUDIENCE, env.JWT_AUDIENCE);
}

export function isAuthCookieSecureDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LEGAL_DASHBOARD_AUTH_COOKIE_SECURE === "0" || env.AUTH_COOKIE_SECURE === "0";
}

export function getTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LEGAL_DASHBOARD_JWT_TTL_SECONDS ?? env.LEGAL_DASHBOARD_AUTH_TOKEN_TTL_SECONDS;
  if (!raw) return 60 * 60;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60 || parsed > 24 * 60 * 60) {
    throw new Error("LEGAL_DASHBOARD_JWT_TTL_SECONDS must be between 60 and 86400 seconds.");
  }
  return Math.floor(parsed);
}

export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = getJwtSecret(env);
  if (!secret || secret.length < WEB_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET este obligatoriu in web mode si trebuie sa aiba cel putin ${WEB_SECRET_MIN_LENGTH} caractere.`
    );
  }
  return secret;
}

export function validateAuthConfig(env: NodeJS.ProcessEnv = process.env): void {
  const mode = getAuthMode(env);
  if (mode === "web") {
    requireJwtSecret(env);
    if (!getJwtIssuer(env)) {
      throw new Error("JWT_ISSUER este obligatoriu in web mode.");
    }
    if (!getJwtAudience(env)) {
      throw new Error("JWT_AUDIENCE este obligatoriu in web mode.");
    }
    getTokenTtlSeconds(env);
    if (isAuthCookieSecureDisabled(env)) {
      if (env.NODE_ENV === "production") {
        throw new Error("AUTH_COOKIE_SECURE=0 nu este permis in productie web.");
      }
      console.warn("[auth.config] AUTH_COOKIE_SECURE=0 permite cookie peste HTTP. Nu folosi in productie.");
    }
  }
}
