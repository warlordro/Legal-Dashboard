// Gard in-proces (v2.43.0): restore-ul inlocuieste fisierul RNPM al ownerului, deci
// nu are voie sa ruleze cat timp o cautare a ACELUIASI owner e in zbor — si invers,
// nicio operatie pe fisier nu are voie sa redeschida fisierul in timpul swap-ului
// (getRnpmDb consulta isRnpmRestoreInProgress). Erori cu cod MASINA pentru envelope.
// Traieste in DB layer ca rnpmDb sa il poata consulta fara dependinta spre services.
const activeSearches = new Map<string, number>();
const restoring = new Set<string>();

export class RnpmSearchActiveError extends Error {
  readonly code = "SEARCH_ACTIVE";
  constructor() {
    super("Exista o cautare RNPM in curs pentru acest cont; operatia e refuzata pana se termina");
  }
}

export class RnpmRestoreInProgressError extends Error {
  readonly code = "RESTORE_IN_PROGRESS";
  constructor() {
    super("Restaurare in curs pentru acest cont; reincearca dupa finalizare");
  }
}

export function beginRnpmSearch(ownerId: string): void {
  if (restoring.has(ownerId)) throw new RnpmRestoreInProgressError();
  activeSearches.set(ownerId, (activeSearches.get(ownerId) ?? 0) + 1);
}

export function endRnpmSearch(ownerId: string): void {
  const n = (activeSearches.get(ownerId) ?? 0) - 1;
  if (n < 0) console.warn(`[rnpmActivity] endRnpmSearch fara begin pentru ${ownerId}`);
  if (n <= 0) activeSearches.delete(ownerId);
  else activeSearches.set(ownerId, n);
}

export function hasActiveRnpmSearch(ownerId: string): boolean {
  return (activeSearches.get(ownerId) ?? 0) > 0;
}

export function beginRnpmRestore(ownerId: string): void {
  if (hasActiveRnpmSearch(ownerId)) throw new RnpmSearchActiveError();
  restoring.add(ownerId);
}

export function endRnpmRestore(ownerId: string): void {
  restoring.delete(ownerId);
}

export function isRnpmRestoreInProgress(ownerId: string): boolean {
  return restoring.has(ownerId);
}

export function __resetRnpmActivityForTests(): void {
  activeSearches.clear();
  restoring.clear();
}
