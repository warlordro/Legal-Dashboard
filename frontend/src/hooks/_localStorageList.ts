// Shared helpers pentru hook-uri care persista o lista FIFO scurta in localStorage
// (useSearchHistory, useRnpmHistory). Singurul scop: try/catch consistent in jur
// de read + write (mod privat Safari, quota exceeded) ca sa nu sparga UI-ul.

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
