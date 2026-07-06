import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ErrorBoundary, PageBoundary } from "@/components/ErrorBoundary";
import { Sidebar } from "@/components/Sidebar";
import { ApiKeyDialog } from "@/components/ApiKeyDialog";
import Dashboard from "@/pages/Dashboard";
import Dosare from "@/pages/Dosare";
import Termene from "@/pages/Termene";
import RnpmSearchPage from "@/pages/RnpmSearch";
import Monitorizare from "@/pages/Monitorizare";
import Alerts from "@/pages/Alerts";
import AdminUsers from "@/pages/admin/Users";
import AdminAudit from "@/pages/admin/Audit";
import AdminQuota from "@/pages/admin/Quota";
import AdminGrants from "@/pages/admin/Grants";
import AdminUsage from "@/pages/admin/Usage";
import AdminKeys from "@/pages/admin/Keys";
import SettingsPage from "@/pages/Settings";
import { AdminGate } from "@/components/AdminGate";
import { useAuthMode } from "@/hooks/useAuthMode";
import { useSessionBootstrap } from "@/hooks/useSessionBootstrap";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useRnpmHistory } from "@/hooks/useRnpmHistory";
import { useApiKey } from "@/hooks/useApiKey";
import { useAiSettings } from "@/hooks/useAiSettings";
import { useAlertsStream } from "@/hooks/useAlertsStream";
import type { Dosar, Termen, SearchParams } from "@/types";
import type { RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  institutii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

interface TermeneState {
  allTermene: Termen[];
  categorii: string[];
  stadii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

// Inner shell — must be inside BrowserRouter so useLocation works
function AppShell({
  dosareState,
  setDosareState,
  termeneState,
  setTermeneState,
  history,
  addEntry,
  removeEntry,
  clearHistory,
  keys,
  aiSettings,
  hasKey,
  handleOpenKeyDialog,
  activeCaptchaKey,
  captchaProvider,
  captchaMode,
  pendingSearch,
  handleHistoryClick,
  consumePendingSearch,
  rnpmHistory,
  addRnpmEntry,
  removeRnpmEntry,
  clearRnpmHistory,
  rnpmPendingSearch,
  handleRnpmHistoryClick,
  consumeRnpmPendingSearch,
}: {
  dosareState: DosareState;
  setDosareState: React.Dispatch<React.SetStateAction<DosareState>>;
  termeneState: TermeneState;
  setTermeneState: React.Dispatch<React.SetStateAction<TermeneState>>;
  history: ReturnType<typeof useSearchHistory>["history"];
  addEntry: ReturnType<typeof useSearchHistory>["addEntry"];
  removeEntry: ReturnType<typeof useSearchHistory>["removeEntry"];
  clearHistory: ReturnType<typeof useSearchHistory>["clearHistory"];
  keys: ReturnType<typeof useApiKey>["keys"];
  aiSettings: ReturnType<typeof useAiSettings>;
  hasKey: boolean;
  handleOpenKeyDialog: () => void;
  activeCaptchaKey: string;
  captchaProvider: ReturnType<typeof useApiKey>["captchaProvider"];
  captchaMode: ReturnType<typeof useApiKey>["captchaMode"];
  pendingSearch: { type: "dosare" | "termene"; params: SearchParams } | null;
  handleHistoryClick: (type: "dosare" | "termene", params: SearchParams) => void;
  consumePendingSearch: () => void;
  rnpmHistory: ReturnType<typeof useRnpmHistory>["history"];
  addRnpmEntry: ReturnType<typeof useRnpmHistory>["addEntry"];
  removeRnpmEntry: ReturnType<typeof useRnpmHistory>["removeEntry"];
  clearRnpmHistory: ReturnType<typeof useRnpmHistory>["clearHistory"];
  rnpmPendingSearch: { type: RnpmSearchType; params: RnpmSearchParams } | null;
  handleRnpmHistoryClick: (type: RnpmSearchType, params: RnpmSearchParams) => void;
  consumeRnpmPendingSearch: () => void;
}) {
  const { pathname } = useLocation();
  const authMode = useAuthMode();
  const mainRef = useRef<HTMLElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const { unreadAlerts, streamVersion: alertsStreamVersion, refreshUnreadAlerts } = useAlertsStream();

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      setCanScrollUp(scrollTop > 300);
      setCanScrollDown(scrollHeight - scrollTop - clientHeight > 300);
    };
    handleScroll(); // check initial state
    el.addEventListener("scroll", handleScroll, { passive: true });
    // Re-check when content changes (e.g. search results load)
    const observer = new ResizeObserver(handleScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, []);

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  // Chrome-ul Electron (drag strip + padding compensator pentru titleBarOverlay)
  // exista DOAR pe desktop; in browser lasa o banda alba moarta sus.
  const isDesktop = typeof window !== "undefined" && !!window.desktopApi;

  return (
    <div className={`flex h-screen overflow-hidden bg-background${isDesktop ? " pt-8" : ""}`}>
      {/* Top 32px drag strip — matches Electron titleBarOverlay height. Windows buttons
          are drawn by the OS on top of this with higher priority, so clicks on them
          still work while the rest of the strip drags the window. */}
      {isDesktop && (
        <div
          className="fixed top-0 left-0 right-0 h-8 bg-background z-[60]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      )}
      <PageBoundary label="Meniu lateral">
        <Sidebar
          history={history}
          onHistoryClick={handleHistoryClick}
          onRemoveEntry={removeEntry}
          onClearHistory={clearHistory}
          hasApiKey={hasKey}
          onConfigureApiKey={handleOpenKeyDialog}
          rnpmHistory={rnpmHistory}
          onRnpmHistoryClick={handleRnpmHistoryClick}
          onRnpmRemoveEntry={removeRnpmEntry}
          onRnpmClearHistory={clearRnpmHistory}
          unreadAlerts={unreadAlerts}
        />
      </PageBoundary>
      <main ref={mainRef} className="flex-1 overflow-y-auto scrollbar-thin relative">
        {/* Dashboard only renders on "/" — no long-running ops */}
        {pathname === "/" && (
          <PageBoundary label="Dashboard">
            <Dashboard
              dosareState={dosareState}
              rnpmHistory={rnpmHistory}
              history={history}
              onHistoryClick={handleHistoryClick}
            />
          </PageBoundary>
        )}

        {/* Dosare & Termene stay mounted so async operations survive tab switches.
            PageBoundary sta in interiorul div-ului keep-mounted si NU e keyed pe
            pathname — un key l-ar remonta la fiecare schimbare de tab si ar rupe
            operatiile async in curs. */}
        <div style={{ display: pathname === "/dosare" ? undefined : "none" }}>
          <PageBoundary label="Cautare Dosare">
            <Dosare
              state={dosareState}
              onStateChange={setDosareState}
              onSearchComplete={(params, count, meta) => addEntry("dosare", params, count, meta)}
              pendingSearch={pendingSearch?.type === "dosare" ? pendingSearch.params : null}
              consumePendingSearch={consumePendingSearch}
              apiKeys={keys}
              aiSettings={{ mode: aiSettings.mode }}
              onConfigureApiKey={handleOpenKeyDialog}
              showBudgetIndicator={pathname === "/dosare" && authMode === "web"}
            />
          </PageBoundary>
        </div>
        <div style={{ display: pathname === "/termene" ? undefined : "none" }}>
          <PageBoundary label="Termene & Calendar">
            <Termene
              state={termeneState}
              onStateChange={setTermeneState}
              onSearchComplete={(params, count) => addEntry("termene", params, count)}
              pendingSearch={pendingSearch?.type === "termene" ? pendingSearch.params : null}
              consumePendingSearch={consumePendingSearch}
            />
          </PageBoundary>
        </div>
        {pathname === "/monitorizare" && (
          <PageBoundary label="Monitorizare">
            <Monitorizare
              onOpenDosar={(numarDosar, source) => handleHistoryClick("dosare", { numarDosar, source })}
              onOpenName={(nume) => handleHistoryClick("dosare", { numeParte: nume })}
            />
          </PageBoundary>
        )}
        {pathname === "/alerte" && (
          <PageBoundary label="Alerte">
            <Alerts
              streamVersion={alertsStreamVersion}
              onAlertsChanged={refreshUnreadAlerts}
              onOpenDosar={(numarDosar, source) => handleHistoryClick("dosare", { numarDosar, source })}
            />
          </PageBoundary>
        )}
        {/* v2.42.0 (5.1): /setari — taburi pe roluri; tab-urile admin refolosesc
            paginile /admin/* cu prop embedded, montate on-demand. */}
        {pathname === "/setari" && (
          <PageBoundary label="Setari">
            <SettingsPage />
          </PageBoundary>
        )}
        {pathname === "/admin/users" && (
          <PageBoundary label="Utilizatori">
            <AdminGate>
              <AdminUsers />
            </AdminGate>
          </PageBoundary>
        )}
        {pathname === "/admin/audit" && (
          <PageBoundary label="Audit">
            <AdminGate>
              <AdminAudit />
            </AdminGate>
          </PageBoundary>
        )}
        {pathname === "/admin/quota" && (
          <PageBoundary label="Cote">
            <AdminGate>
              <AdminQuota />
            </AdminGate>
          </PageBoundary>
        )}
        {pathname === "/admin/grants" && (
          <PageBoundary label="Granturi">
            <AdminGate>
              <AdminGrants />
            </AdminGate>
          </PageBoundary>
        )}
        {pathname === "/admin/usage" && (
          <PageBoundary label="Consum">
            <AdminGate>
              <AdminUsage />
            </AdminGate>
          </PageBoundary>
        )}
        {pathname === "/admin/keys" && (
          <PageBoundary label="Chei API">
            <AdminGate>
              <AdminKeys />
            </AdminGate>
          </PageBoundary>
        )}
        <div style={{ display: pathname === "/rnpm" ? undefined : "none" }}>
          <PageBoundary label="Cautare RNPM">
            <RnpmSearchPage
              captchaKey={activeCaptchaKey}
              captchaProvider={captchaProvider}
              fallback2CaptchaKey={
                captchaMode === "race"
                  ? captchaProvider === "capsolver"
                    ? keys.twocaptcha
                    : keys.capsolver
                  : captchaProvider === "capsolver"
                    ? keys.twocaptcha
                    : undefined
              }
              captchaMode={captchaMode}
              onConfigureKey={handleOpenKeyDialog}
              onSearchComplete={addRnpmEntry}
              pendingSearch={rnpmPendingSearch}
              consumePendingSearch={consumeRnpmPendingSearch}
            />
          </PageBoundary>
        </div>

        {/* Scroll navigation buttons */}
        {(canScrollUp || canScrollDown) && (
          <div className="fixed bottom-4 right-2 z-40 flex flex-col gap-1.5">
            {canScrollUp && (
              <button
                type="button"
                onClick={scrollToTop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/80 text-primary-foreground shadow-md transition-all hover:scale-110 hover:bg-primary hover:shadow-lg active:scale-95"
                title="Inapoi sus"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
            {canScrollDown && (
              <button
                type="button"
                onClick={scrollToBottom}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/80 text-primary-foreground shadow-md transition-all hover:scale-110 hover:bg-primary hover:shadow-lg active:scale-95"
                title="Mergi jos"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Full-screen message shown while the web session bootstraps, or when the
// handshake hard-fails (account not provisioned / bridge unavailable).
function AuthBootScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// All data hooks + the authenticated shell live here so NOTHING fetches before
// App's session gate has established the web cookie — e.g. useAiSettings fetches
// /api/v1/ai/settings on mount, which would otherwise race the mint into a 401.
// Mounted only once the gate opens (or immediately on desktop).
function AuthedApp() {
  useSessionKeepAlive();
  const [dosareState, setDosareState] = useState<DosareState>({
    allDosare: [],
    categorii: [],
    stadii: [],
    institutii: [],
    searched: false,
    error: null,
  });

  const [termeneState, setTermeneState] = useState<TermeneState>({
    allTermene: [],
    categorii: [],
    stadii: [],
    searched: false,
    error: null,
  });

  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory();
  const {
    history: rnpmHistory,
    addEntry: addRnpmEntry,
    removeEntry: removeRnpmEntry,
    clearHistory: clearRnpmHistory,
  } = useRnpmHistory();
  const {
    keys,
    setKey,
    clearKey,
    hasKey,
    hasAnthropic,
    hasOpenai,
    hasGoogle,
    hasOpenrouter,
    hasTwoCaptcha,
    hasCapSolver,
    captchaProvider,
    setCaptchaProvider,
    captchaMode,
    setCaptchaMode,
    activeCaptchaKey,
  } = useApiKey();
  const aiSettings = useAiSettings();
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const handleOpenKeyDialog = useCallback(() => setShowKeyDialog(true), []);
  const closeKeyDialog = useCallback(() => setShowKeyDialog(false), []);

  // Callback for when a search from history is clicked
  const [pendingSearch, setPendingSearch] = useState<{
    type: "dosare" | "termene";
    params: SearchParams;
  } | null>(null);

  const handleHistoryClick = (type: "dosare" | "termene", params: SearchParams) => {
    setPendingSearch({ type, params });
  };

  const consumePendingSearch = () => {
    const search = pendingSearch;
    setPendingSearch(null);
    return search;
  };

  const [rnpmPendingSearch, setRnpmPendingSearch] = useState<{ type: RnpmSearchType; params: RnpmSearchParams } | null>(
    null
  );
  const handleRnpmHistoryClick = (type: RnpmSearchType, params: RnpmSearchParams) => {
    setRnpmPendingSearch({ type, params });
  };
  const consumeRnpmPendingSearch = () => {
    setRnpmPendingSearch(null);
  };

  return (
    <BrowserRouter>
      <ConfirmProvider>
        <AppShell
          dosareState={dosareState}
          setDosareState={setDosareState}
          termeneState={termeneState}
          setTermeneState={setTermeneState}
          history={history}
          addEntry={addEntry}
          removeEntry={removeEntry}
          clearHistory={clearHistory}
          keys={keys}
          aiSettings={aiSettings}
          hasKey={hasKey}
          handleOpenKeyDialog={handleOpenKeyDialog}
          activeCaptchaKey={activeCaptchaKey}
          captchaProvider={captchaProvider}
          captchaMode={captchaMode}
          pendingSearch={pendingSearch}
          handleHistoryClick={handleHistoryClick}
          consumePendingSearch={consumePendingSearch}
          rnpmHistory={rnpmHistory}
          addRnpmEntry={addRnpmEntry}
          removeRnpmEntry={removeRnpmEntry}
          clearRnpmHistory={clearRnpmHistory}
          rnpmPendingSearch={rnpmPendingSearch}
          handleRnpmHistoryClick={handleRnpmHistoryClick}
          consumeRnpmPendingSearch={consumeRnpmPendingSearch}
        />
        {showKeyDialog && (
          <ErrorBoundary variant="page" label="Configurare chei API">
            <ApiKeyDialog
              onClose={closeKeyDialog}
              apiKey={{
                setKey,
                clearKey,
                hasKey,
                hasAnthropic,
                hasOpenai,
                hasGoogle,
                hasOpenrouter,
                hasTwoCaptcha,
                hasCapSolver,
                captchaProvider,
                setCaptchaProvider,
                captchaMode,
                setCaptchaMode,
                aiSettings,
              }}
            />
          </ErrorBoundary>
        )}
      </ConfirmProvider>
    </BrowserRouter>
  );
}

export default function App() {
  const { ready, status } = useSessionBootstrap();

  // Web-mode session gate. Hold the ENTIRE authenticated app (including data
  // hooks that fetch on mount, e.g. useAiSettings) until the cookie handshake
  // settles, so the first /api call carries the cookie instead of racing it
  // into a 401 "Token de autentificare necesar.". Desktop: `ready` is true from
  // first render, so this is a pass-through with no fetch.
  if (!ready) {
    return <AuthBootScreen message="Se conecteaza..." />;
  }
  // 403: not provisioned / inactive / forbidden — all "your account can't get a
  // session". 400|503: desktop_only / missing_identity / bridge_disabled — all
  // "server-side web auth is misconfigured". Messages stay broad on purpose so
  // they don't assert a single cause the status doesn't pin down.
  if (status === "not_provisioned") {
    return (
      <AuthBootScreen message="Acces refuzat. Contul nu este configurat sau este inactiv — contacteaza administratorul." />
    );
  }
  if (status === "unavailable") {
    return (
      <AuthBootScreen message="Sesiunea web nu a putut fi initializata (configurare server invalida). Contacteaza administratorul." />
    );
  }
  // "ok" and transient "error" render the app; per-request error states surface
  // any lingering 401s rather than locking the user out on a network blip.
  return <AuthedApp />;
}
