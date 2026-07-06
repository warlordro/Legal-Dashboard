import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./index.css";
import App from "./App.tsx";

// v2.42.0 (6.1): auto-recuperare la chunk-uri stale (web, dupa redeploy).
// Vite emite `vite:preloadError` cand un import dinamic pica (hash-urile vechi
// nu mai exista pe server dupa un deploy). Reincarcam O DATA, cu guard de 60s
// in sessionStorage impotriva buclei; daca storage-ul arunca (privacy mode),
// NU reincarcam — fara guard persistent am risca bucla infinita; lasa eroarea
// la ErrorBoundary (10.4b).
const CHUNK_RELOAD_KEY = "portaljust-chunk-reload-at";
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return; // lasa la ErrorBoundary
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    return; // privacy mode: NU reincarca
  }
  event.preventDefault();
  window.location.reload();
});

// Boundary la nivel de aplicatie — trebuie sa stea in afara lui <App/>, fiindca
// un error boundary nu prinde erorile componentei care il randeaza. App()
// apeleaza hook-uri care parseaza localStorage (useApiKey, useAiSettings etc.);
// daca acelea arunca, doar un boundary din exterior poate prinde crash-ul.
// biome-ignore lint/style/noNonNullAssertion: root exista in index.html pentru aplicatia React.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary variant="app">
      <App />
    </ErrorBoundary>
  </StrictMode>
);
