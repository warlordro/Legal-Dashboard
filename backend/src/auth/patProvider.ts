// patProvider.ts — rezolva contextul de auth dintr-un Personal Access Token (PAT).
// hash -> lookup -> user activ. Fara cache pozitiv (validare DB per-request ->
// revoke instant). 401-ul e generic `invalid_token` pentru orice esec (token
// inexistent / revocat / expirat / user inactiv) — anti-enumerare; pe un token de
// 256-bit nu exista canal de timing exploatabil, deci nu egalizam artificial ramurile.

import type { Context } from "hono";
import { AuthenticationError, type AuthenticatedContext } from "./authProvider.ts";
import { findActiveTokenByHash, hashToken } from "../db/apiTokenRepository.ts";
import { getUserById } from "../db/userRepository.ts";

export function resolvePatContext(_c: Context, token: string): AuthenticatedContext {
  const row = findActiveTokenByHash(hashToken(token));
  if (!row) {
    throw new AuthenticationError(401, "invalid_token", "Token de autentificare invalid.");
  }
  // Paritate JWT<->PAT: calea JWT gate-uieste user-ul DOAR pe existenta + status==="active"
  // (UserRow nu are emailVerified/bannedAt; status consolideaza suspended/deleted). Replicam exact.
  const user = getUserById(row.owner_id);
  if (user === null || user.status !== "active") {
    throw new AuthenticationError(401, "invalid_token", "Token de autentificare invalid.");
  }
  return {
    ownerId: user.id,
    actorId: user.id,
    user,
    tokenScopes: row.scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    tokenId: row.id,
  };
}
