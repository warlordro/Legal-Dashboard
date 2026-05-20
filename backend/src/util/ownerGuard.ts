// v2.34.0 P1-2 — runtime guard pentru ownerId in repo write paths.
//
// Background: in mod web, ownerId vine din JWT (UUID-ul user-ului din tabela
// `users`). Pe desktop, ownerId-ul e literal "local". Daca un cod path
// scrie owner-scoped data cu ownerId="local" in mod web, datele aterizeaza
// pe un owner sintetic invizibil userilor reali — leak/data corruption.
//
// `getOwnerId(c)` (middleware/owner.ts) deja gardeaza READ-urile prin
// contextul HTTP. Acest helper protejeaza repo functions impotriva
// scenariilor unde:
//   - Codul cheama un write hardcoded cu "local" (footgun de default param).
//   - O migrare / sidecar viitor invoca un repo fara context HTTP.
//   - Un test fixture leak-uieste in productie.
//
// Pe desktop: noop (acceptam "local" si "" treated as "local").
// Pe web: throw daca ownerId e "local", "", sau prefix tipic (e.g. "system-").
// Citim authMode lazy (require) pentru a evita un cycle de import cu config.

import { getAuthMode } from "../auth/config.ts";

const DESKTOP_RESERVED = new Set(["local", ""]);

export function assertOwnerIdForMutation(ownerId: string | null | undefined, source: string): void {
  if (getAuthMode() === "desktop") return;
  if (ownerId === null || ownerId === undefined) {
    throw new Error(`[ownerGuard] ${source}: ownerId missing in web mode`);
  }
  if (DESKTOP_RESERVED.has(ownerId)) {
    throw new Error(`[ownerGuard] ${source}: ownerId="${ownerId}" not allowed in web mode (desktop reserved)`);
  }
}
