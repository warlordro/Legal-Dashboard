// Punte cu o singura directie intre `ensureWebSession()` (lib/api) si store-ul
// /me (hooks/useCurrentUser). Traieste separat ca sa nu apara un ciclu de
// import: useCurrentUser importa deja `me` din lib/api.
//
// De ce exista: cookie-ul oauth2-proxy e la nivel de browser, nu de tab. Daca
// intr-un alt tab se logheaza alt cont, tabul vechi isi re-minteaza tacit
// sesiunea pe NOUA identitate la expirarea JWT-ului (~1h) sau la keep-alive.
// Fara semnalul asta, store-ul /me ramane cu utilizatorul vechi: UI-ul arata un
// nume, iar cererile pleaca pe seama altui cont — inclusiv scrierile in
// istoricul partitionat pe utilizator.

type Listener = () => void;

const listeners = new Set<Listener>();

export function onSessionReminted(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSessionReminted(): void {
  for (const listener of listeners) listener();
}
