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
import { AdminGate } from "@/components/AdminGate";
import { useAuthMode } from "@/hooks/useAuthMode";
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

  return (
    <div className="flex h-screen overflow-hidden bg-background pt-8">
      {/* Top 32px drag strip — matches Electron titleBarOverlay height. Windows buttons
          are drawn by the OS on top of this with higher priority, so clicks on them
          still work while the rest of the strip drags the window. */}
      <div
        className="fixed top-0 left-0 right-0 h-8 bg-background z-[60]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
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
              aiSettings={{ mode: aiSettings.mode, stack: aiSettings.stack }}
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
              onOpenDosar={(numarDosar) => handleHistoryClick("dosare", { numarDosar })}
              onOpenName={(nume) => handleHistoryClick("dosare", { numeParte: nume })}
            />
          </PageBoundary>
        )}
        {pathname === "/alerte" && (
          <PageBoundary label="Alerte">
            <Alerts
              streamVersion={alertsStreamVersion}
              onAlertsChanged={refreshUnreadAlerts}
              onOpenDosar={(numarDosar) => handleHistoryClick("dosare", { numarDosar })}
            />
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

export default function App() {
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
