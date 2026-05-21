import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./index.css";
import App from "./App.tsx";

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
