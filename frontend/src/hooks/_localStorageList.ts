// Shared helpers pentru hook-uri care persista o lista FIFO scurta in localStorage
// (useSearchHistory, useRnpmHistory). Singurul scop: try/catch consistent in jur
// de read + write (mod privat Safari, quota exceeded) ca sa nu sparga UI-ul.

// Cheia efectiva sub care se persista lista: una per utilizator logat.
// In web mode acelasi browser e folosit de conturi diferite (deploy NAS, Google
// OAuth per persoana); cu o cheie fixa, istoricul unui user — CUI-uri, nume,
// CNP-uri introduse ca criterii — era vizibil oricui se loga dupa el pe acelasi
// browser. Pe desktop ownerId e "local", deci o singura partitie, ca inainte.
export function scopedKey(baseKey: string, ownerId: string): string {
  return `${baseKey}::${ownerId}`;
}

// Tranzitia de la cheia veche, nescopata, la partitii per utilizator.
//
// Desktop: exista un singur owner (`local`), deci continutul vechi ii apartine
// cu certitudine — se muta in partitia lui, altfel fiecare utilizator desktop
// si-ar pierde istoricul la primul start dupa upgrade. Nu suprascriem o partitie
// deja populata (a doua rulare nu mai are ce migra).
//
// Web: continutul vechi nu poate fi atribuit niciunui cont — pe un browser
// partajat ar putea fi al altcuiva — deci se sterge, nu se migreaza.
export function migrateLegacyList(baseKey: string, ownerId: string): void {
  const isDesktop = typeof window !== "undefined" && window.desktopApi !== undefined;
  if (isDesktop) {
    const legacy = readList<unknown>(baseKey);
    if (legacy.length > 0 && readList<unknown>(scopedKey(baseKey, ownerId)).length === 0) {
      writeList(scopedKey(baseKey, ownerId), legacy);
    }
  }
  clearList(baseKey);
}

export function readList<T>(storageKey: string): T[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeList<T>(storageKey: string, entries: T[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Quota exceeded / private mode — swallow silently, UI state ramane in memorie.
  }
}

export function clearList(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Safari private mode poate throw aici, ignoram.
  }
}
