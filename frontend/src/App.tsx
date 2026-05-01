import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { ArrowUp, ArrowDown } from "lucide-react";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
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
import { AdminGate } from "@/components/AdminGate";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useRnpmHistory } from "@/hooks/useRnpmHistory";
import { useApiKey } from "@/hooks/useApiKey";
import { alertsApi, type MonitoringAlert } from "@/lib/alertsApi";
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
  dosareState, setDosareState,
  termeneState, setTermeneState,
  history, addEntry, removeEntry, clearHistory,
  keys, hasKey, handleOpenKeyDialog, activeCaptchaKey, captchaProvider, captchaMode,
  pendingSearch, handleHistoryClick, consumePendingSearch,
  rnpmHistory, addRnpmEntry, removeRnpmEntry, clearRnpmHistory,
  rnpmPendingSearch, handleRnpmHistoryClick, consumeRnpmPendingSearch,
}: {
  dosareState: DosareState; setDosareState: React.Dispatch<React.SetStateAction<DosareState>>;
  termeneState: TermeneState; setTermeneState: React.Dispatch<React.SetStateAction<TermeneState>>;
  history: ReturnType<typeof useSearchHistory>["history"];
  addEntry: ReturnType<typeof useSearchHistory>["addEntry"];
  removeEntry: ReturnType<typeof useSearchHistory>["removeEntry"];
  clearHistory: ReturnType<typeof useSearchHistory>["clearHistory"];
  keys: ReturnType<typeof useApiKey>["keys"];
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
  const mainRef = useRef<HTMLElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [alertsStreamVersion, setAlertsStreamVersion] = useState(0);

  const refreshUnreadAlerts = useCallback(async () => {
    try {
      const result = await alertsApi.list({ page: 1, pageSize: 1, onlyUnread: true });
      setUnreadAlerts(result.unread);
    } catch (err) {
      console.warn("[alerts] unread count refresh failed", err);
    }
  }, []);

  const showDesktopNotification = useCallback((alert: MonitoringAlert) => {
    // Suppress when the user is already looking at the app — the in-app badge
    // and Alerts page are sufficient. Covers both Electron and browser modes.
    if (typeof document !== "undefined"
      && document.visibilityState === "visible"
      && document.hasFocus()) {
      return;
    }
    const title = "Legal Dashboard - alerta noua";
    const body = alert.title.length > 120 ? `${alert.title.slice(0, 117)}...` : alert.title;
    const tag = alert.dedup_key || `alert-${alert.id}`;
    if (window.desktopApi?.showNotification) {
      window.desktopApi.showNotification({
        title,
        body,
        silent: alert.severity === "info",
        tag,
      }).catch((err) => console.warn("[alerts] native notification failed", err));
      return;
    }
    if (!("Notification" in window)) return;
    const notify = () => {
      try {
        new Notification(title, {
          body,
          tag,
          silent: alert.severity === "info",
        });
      } catch (err) {
        console.warn("[alerts] desktop notification failed", err);
      }
    };
    if (Notification.permission === "granted") {
      notify();
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") notify();
      }).catch((err) => console.warn("[alerts] notification permission failed", err));
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let retryMs = 1000;

    const cleanupSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, 30000);
    };

    const connect = () => {
      cleanupSource();
      const es = new EventSource("/api/v1/alerts/stream");
      eventSourceRef.current = es;
      es.addEventListener("open", () => {
        retryMs = 1000;
        // Refresh server-truth counter and bump streamVersion so the Alerts
        // page re-fetches its visible list — covers any alerts dropped while
        // the SSE connection was disconnected.
        refreshUnreadAlerts();
        setAlertsStreamVersion((v) => v + 1);
      });
      es.addEventListener("alert", (event) => {
        try {
          const alert = JSON.parse((event as MessageEvent).data) as MonitoringAlert;
          if (!alert.read_at && !alert.dismissed_at) {
            showDesktopNotification(alert);
          }
          // Server-truth counter — avoids racing with optimistic increments.
          refreshUnreadAlerts();
          setAlertsStreamVersion((v) => v + 1);
        } catch (err) {
          console.warn("[alerts] invalid SSE event", err);
          refreshUnreadAlerts();
        }
      });
      // F7 — backend emits `alert_enriched` when the runner backfills
      // solutie_sumar / numar_document / instanta on an existing alert (the
      // PortalJust ruling text appears in a later tick than the alert itself).
      // Bumping streamVersion is enough: the Alerts page listens on it and
      // re-fetches the visible page, picking up the patched detail_json. We
      // intentionally do NOT trigger a desktop notification or unread refresh
      // — enrichment isn't a new alert and counters haven't moved.
      es.addEventListener("alert_enriched", () => {
        setAlertsStreamVersion((v) => v + 1);
      });
      es.onerror = () => {
        cleanupSource();
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      stopped = true;
      cleanupSource();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [refreshUnreadAlerts, showDesktopNotification]);

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
    return () => { el.removeEventListener("scroll", handleScroll); observer.disconnect(); };
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
      <main ref={mainRef} className="flex-1 overflow-y-auto scrollbar-thin relative">
        {/* Dashboard only renders on "/" — no long-running ops */}
        {pathname === "/" && (
          <Dashboard
            dosareState={dosareState}
            rnpmHistory={rnpmHistory}
            history={history}
            onHistoryClick={handleHistoryClick}
          />
        )}

        {/* Dosare & Termene stay mounted so async operations survive tab switches */}
        <div style={{ display: pathname === "/dosare" ? undefined : "none" }}>
          <Dosare
            state={dosareState}
            onStateChange={setDosareState}
            onSearchComplete={(params, count, meta) => addEntry("dosare", params, count, meta)}
            pendingSearch={pendingSearch?.type === "dosare" ? pendingSearch.params : null}
            consumePendingSearch={consumePendingSearch}
            apiKeys={keys}
            onConfigureApiKey={handleOpenKeyDialog}
          />
        </div>
        <div style={{ display: pathname === "/termene" ? undefined : "none" }}>
          <Termene
            state={termeneState}
            onStateChange={setTermeneState}
            onSearchComplete={(params, count) => addEntry("termene", params, count)}
            pendingSearch={pendingSearch?.type === "termene" ? pendingSearch.params : null}
            consumePendingSearch={consumePendingSearch}
          />
        </div>
        {pathname === "/monitorizare" && (
          <Monitorizare
            onOpenDosar={(numarDosar) => handleHistoryClick("dosare", { numarDosar })}
            onOpenName={(nume) => handleHistoryClick("dosare", { numeParte: nume })}
          />
        )}
        {pathname === "/alerte" && (
          <Alerts
            streamVersion={alertsStreamVersion}
            onAlertsChanged={refreshUnreadAlerts}
            onOpenDosar={(numarDosar) => handleHistoryClick("dosare", { numarDosar })}
          />
        )}
        {pathname === "/admin/users" && (
          <AdminGate><AdminUsers /></AdminGate>
        )}
        {pathname === "/admin/audit" && (
          <AdminGate><AdminAudit /></AdminGate>
        )}
        {pathname === "/admin/quota" && (
          <AdminGate><AdminQuota /></AdminGate>
        )}
        <div style={{ display: pathname === "/rnpm" ? undefined : "none" }}>
          <RnpmSearchPage
            captchaKey={activeCaptchaKey}
            captchaProvider={captchaProvider}
            fallback2CaptchaKey={captchaMode === "race" ? (captchaProvider === "capsolver" ? keys.twocaptcha : keys.capsolver) : (captchaProvider === "capsolver" ? keys.twocaptcha : undefined)}
            captchaMode={captchaMode}
            onConfigureKey={handleOpenKeyDialog}
            onSearchComplete={addRnpmEntry}
            pendingSearch={rnpmPendingSearch}
            consumePendingSearch={consumeRnpmPendingSearch}
          />
        </div>

        {/* Scroll navigation buttons */}
        {(canScrollUp || canScrollDown) && (
          <div className="fixed bottom-4 right-2 z-40 flex flex-col gap-1.5">
            {canScrollUp && (
              <button
                onClick={scrollToTop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/80 text-primary-foreground shadow-md transition-all hover:scale-110 hover:bg-primary hover:shadow-lg active:scale-95"
                title="Inapoi sus"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
            {canScrollDown && (
              <button
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
  const { history: rnpmHistory, addEntry: addRnpmEntry, removeEntry: removeRnpmEntry, clearHistory: clearRnpmHistory } = useRnpmHistory();
  const { keys, setKey, clearKey, hasKey, hasAnthropic, hasOpenai, hasGoogle, hasTwoCaptcha, hasCapSolver, captchaProvider, setCaptchaProvider, captchaMode, setCaptchaMode, activeCaptchaKey } = useApiKey();
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

  const [rnpmPendingSearch, setRnpmPendingSearch] = useState<{ type: RnpmSearchType; params: RnpmSearchParams } | null>(null);
  const handleRnpmHistoryClick = (type: RnpmSearchType, params: RnpmSearchParams) => {
    setRnpmPendingSearch({ type, params });
  };
  const consumeRnpmPendingSearch = () => { setRnpmPendingSearch(null); };

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
        <ApiKeyDialog
          onClose={closeKeyDialog}
          apiKey={{
            setKey,
            clearKey,
            hasKey,
            hasAnthropic,
            hasOpenai,
            hasGoogle,
            hasTwoCaptcha,
            hasCapSolver,
            captchaProvider,
            setCaptchaProvider,
            captchaMode,
            setCaptchaMode,
          }}
        />
      )}
      </ConfirmProvider>
    </BrowserRouter>
  );
}
