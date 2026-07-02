import { apiFetch, extractErrorMessage } from "./api";

// Arunca pe raspunsuri non-2xx (fix audit: un 403/500 nu mai e inghitit silentios).
async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `Eroare server (HTTP ${res.status})`;
  try {
    message = extractErrorMessage(await res.clone().json(), message);
  } catch {
    /* corp non-JSON -> pastreaza mesajul cu status */
  }
  throw new Error(message);
}

// Wrapper subtire peste apiFetch pentru rutele de management PAT (piesa A, web mode).
// Toate raspunsurile folosesc envelope-ul { data, error, requestId }.

export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: string[];
  tokenPrefix: string;
  captchaDailyCap: number | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}

export interface CreatedApiToken extends ApiTokenSummary {
  secret: string; // afisat O SINGURA DATA
}

export interface CreateApiTokenInput {
  name: string;
  scopes: string[];
  captchaDailyCap?: number | null;
  expiresInDays?: 30 | 90 | 365 | null;
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const res = await ensureOk(await apiFetch("/api/v1/tokens"));
  return ((await res.json()) as { data: ApiTokenSummary[] }).data;
}

export async function createApiToken(body: CreateApiTokenInput): Promise<CreatedApiToken> {
  const res = await ensureOk(
    await apiFetch("/api/v1/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return ((await res.json()) as { data: CreatedApiToken }).data;
}

export async function revokeApiToken(id: string): Promise<void> {
  await ensureOk(await apiFetch(`/api/v1/tokens/${id}`, { method: "DELETE" }));
}

export async function revokeAllApiTokens(): Promise<void> {
  await ensureOk(await apiFetch("/api/v1/tokens/revoke-all", { method: "POST" }));
}
