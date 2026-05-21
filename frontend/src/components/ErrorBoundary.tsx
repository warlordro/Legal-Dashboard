// ErrorBoundary.tsx — audit finding B1 (2026-05-22).
//
// React nu are mecanism de recuperare la nivel de renderer in afara error
// boundaries. Fara ele, orice exceptie aruncata in timpul render-ului
// (parsare localStorage corupt, raspuns API cu forma neasteptata, bug intr-un
// chart) deruleaza tot arborele si lasa userul cu ecran alb — identic in
// Electron si in web mode, fiindca acelasi bundle ruleaza in ambele.
//
// Doua variante:
//   - variant="app": montat in main.tsx in jurul intregului <App/>. Singura
//     recuperare posibila e un reload complet, fiindca state-ul global e deja
//     compromis. Prinde inclusiv crash-urile din hook-urile lui App() (ex.
//     useApiKey care parseaza localStorage) — de aceea trebuie sa stea in
//     afara lui App(): un boundary nu prinde erorile componentei care il
//     randeaza.
//   - variant="page": montat in jurul fiecarui slot de pagina + Sidebar +
//     ApiKeyDialog. Izoleaza crash-ul la sectiunea afectata; restul aplicatiei
//     ramane utilizabil. Butonul "Reincearca" reseteaza boundary-ul fara
//     reload, deci o eroare tranzitorie se poate recupera in loc.
//
// Limitare cunoscuta: error boundaries prind doar erori din render, lifecycle
// si constructori. NU prind erori din event handlers, cod async (setTimeout,
// fetch .then), SSR sau din boundary-ul insusi. Acele cai trebuie sa-si
// trateze erorile local (try/catch + state de eroare).

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  variant: "app" | "page";
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const INITIAL_STATE: ErrorBoundaryState = {
  hasError: false,
  error: null,
  errorInfo: null,
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // componentStack ramane DOAR in consola — nu se randeaza niciodata in DOM,
    // poate contine detalii interne de implementare.
    console.error("[ErrorBoundary]", {
      label: this.props.label ?? this.props.variant,
      error,
      componentStack: errorInfo.componentStack,
    });
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleRetry = (): void => {
    this.setState(INITIAL_STATE);
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { variant, label } = this.props;
    // Mesajul tehnic al erorii se arata doar in dev; in productie e ascuns ca
    // sa nu scape detalii interne catre user. import.meta.env.DEV e inlocuit
    // static de Vite, deci ramura asta e tree-shaken in build-ul de productie.
    const devMessage = import.meta.env.DEV ? this.state.error?.message : null;

    if (variant === "app") {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h1 className="text-xl font-semibold">Aplicatia a intampinat o eroare</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ceva nu a functionat corect si aplicatia nu poate continua. Reincarca pentru a relua.
            </p>
            {devMessage && (
              <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
                {devMessage}
              </pre>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              Reincarca aplicatia
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="m-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
        <h2 className="text-lg font-semibold">Aceasta sectiune a intampinat o eroare</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {label ? `Sectiunea "${label}" nu a putut fi afisata.` : "Sectiunea nu a putut fi afisata."} Restul aplicatiei
          functioneaza in continuare.
        </p>
        {devMessage && (
          <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
            {devMessage}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleRetry}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Reincearca
        </button>
      </div>
    );
  }
}

// Wrapper subtire ca App.tsx sa ramana lizibil: <PageBoundary label="..."> in
// loc de <ErrorBoundary variant="page" label="...">.
export function PageBoundary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ErrorBoundary variant="page" label={label}>
      {children}
    </ErrorBoundary>
  );
}
