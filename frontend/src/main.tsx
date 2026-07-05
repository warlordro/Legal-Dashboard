import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./index.css";
import App from "./App.tsx";

// v2.42.0 (web): dupa un redeploy, chunk-urile lazy vechi (Manual/Changelog/
// Metrics) nu mai exista pe server si import() esueaza — inainte, userul vedea
// ErrorBoundary. Vite emite "vite:preloadError" in acest caz; un reload aduce
// index-ul nou cu hash-urile corecte. Guard pe timestamp (nu flag simplu) ca un
// tab lasat deschis peste MAI MULTE deploy-uri sa se recupereze de fiecare
// data, dar fara bucla de reload daca serverul chiar e stricat.
const CHUNK_RELOAD_KEY = "portaljust-chunk-reload-at";
const CHUNK_RELOAD_MIN_INTERVAL_MS = 60_000;
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
  if (Date.now() - last < CHUNK_RELOAD_MIN_INTERVAL_MS) return; // lasa eroarea sa ajunga la ErrorBoundary
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
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
