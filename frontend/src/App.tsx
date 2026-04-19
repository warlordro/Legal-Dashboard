import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { Key, X, Bot, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { Sidebar } from "@/components/Sidebar";
import { useDialog } from "@/hooks/useDialog";
import Dashboard from "@/pages/Dashboard";
import Dosare from "@/pages/Dosare";
import Termene from "@/pages/Termene";
import RnpmSearchPage from "@/pages/RnpmSearch";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { useRnpmHistory } from "@/hooks/useRnpmHistory";
import { useApiKey } from "@/hooks/useApiKey";
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
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

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
  const [keyInputs, setKeyInputs] = useState({ anthropic: "", openai: "", google: "", twocaptcha: "", capsolver: "" });

  const handleSaveKeys = () => {
    if (keyInputs.anthropic.trim()) setKey("anthropic", keyInputs.anthropic);
    if (keyInputs.openai.trim()) setKey("openai", keyInputs.openai);
    if (keyInputs.google.trim()) setKey("google", keyInputs.google);
    if (keyInputs.twocaptcha.trim()) setKey("twocaptcha", keyInputs.twocaptcha);
    if (keyInputs.capsolver.trim()) setKey("capsolver", keyInputs.capsolver);
    setKeyInputs({ anthropic: "", openai: "", google: "", twocaptcha: "", capsolver: "" });
  };

  const handleOpenKeyDialog = () => {
    setKeyInputs({ anthropic: "", openai: "", google: "", twocaptcha: "", capsolver: "" });
    setShowKeyDialog(true);
  };

  const closeKeyDialog = useCallback(() => setShowKeyDialog(false), []);
  const keyDialogRef = useDialog<HTMLDivElement>(showKeyDialog, closeKeyDialog);

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
      {/* Global API Key Dialog — Multi-Provider */}
      {showKeyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeKeyDialog}>
          <div
            ref={keyDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-dialog-title"
            tabIndex={-1}
            className="w-full max-w-3xl rounded-xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="api-key-dialog-title" className="flex items-center gap-2 text-lg font-semibold">
                <Key className="h-5 w-5 text-violet-600" />
                Configurare Chei API
              </h3>
              <button onClick={closeKeyDialog} aria-label="Inchide configurare chei" className="rounded-lg p-1 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Introdu cheile API pentru furnizorii AI pe care doresti sa ii folosesti. Poti configura unul sau mai multi.
            </p>

            {/* AI providers — side-by-side */}
            <div className="mb-3 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-violet-500" />
                    Anthropic
                  </span>
                  {hasAnthropic && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
                </div>
                <input
                  type="password"
                  placeholder={hasAnthropic ? "Cheie noua..." : "sk-ant-api03-..."}
                  value={keyInputs.anthropic}
                  onChange={(e) => setKeyInputs({ ...keyInputs, anthropic: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  autoFocus
                />
                {hasAnthropic && (
                  <button className="mt-1.5 text-[11px] text-red-500 hover:underline" onClick={() => { clearKey("anthropic"); }}>
                    Sterge cheia
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    OpenAI
                  </span>
                  {hasOpenai && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
                </div>
                <input
                  type="password"
                  placeholder={hasOpenai ? "Cheie noua..." : "sk-proj-..."}
                  value={keyInputs.openai}
                  onChange={(e) => setKeyInputs({ ...keyInputs, openai: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                {hasOpenai && (
                  <button className="mt-1.5 text-[11px] text-red-500 hover:underline" onClick={() => { clearKey("openai"); }}>
                    Sterge cheia
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
                    Google
                  </span>
                  {hasGoogle && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
                </div>
                <input
                  type="password"
                  placeholder={hasGoogle ? "Cheie noua..." : "AIza..."}
                  value={keyInputs.google}
                  onChange={(e) => setKeyInputs({ ...keyInputs, google: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {hasGoogle && (
                  <button className="mt-1.5 text-[11px] text-red-500 hover:underline" onClick={() => { clearKey("google"); }}>
                    Sterge cheia
                  </button>
                )}
              </div>
            </div>

            {/* Captcha provider selector */}
            <div className="mb-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  Captcha RNPM — provider activ
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCaptchaProvider("2captcha")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaProvider === "2captcha" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  2Captcha {hasTwoCaptcha && <span className="ml-1 text-green-600">●</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setCaptchaProvider("capsolver")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaProvider === "capsolver" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  CapSolver {hasCapSolver && <span className="ml-1 text-green-600">●</span>}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Selecteaza providerul folosit pentru rezolvarea reCAPTCHA la cautarile RNPM.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCaptchaMode("sequential")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaMode === "sequential" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  Secvential (fallback)
                </button>
                <button
                  type="button"
                  onClick={() => setCaptchaMode("race")}
                  disabled={!(hasTwoCaptcha && hasCapSolver)}
                  title={!(hasTwoCaptcha && hasCapSolver) ? "Necesita ambele chei setate" : undefined}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${captchaMode === "race" ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "border-border bg-background text-muted-foreground hover:bg-muted"} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Paralel (race)
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Secvential: primary cu fallback daca esueaza. Paralel: porneste ambele, castiga cel mai rapid (cost dublu).
              </p>
            </div>

            {/* 2Captcha + CapSolver side-by-side */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    2Captcha
                  </span>
                  {hasTwoCaptcha && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
                </div>
                <input
                  type="password"
                  placeholder={hasTwoCaptcha ? "Cheie noua..." : "cheia 2captcha.com..."}
                  value={keyInputs.twocaptcha}
                  onChange={(e) => setKeyInputs({ ...keyInputs, twocaptcha: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
                {hasTwoCaptcha && (
                  <button className="mt-1.5 text-[11px] text-red-500 hover:underline" onClick={() => { clearKey("twocaptcha"); }}>
                    Sterge cheia
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  ~$0.003/captcha, fallback uman.
                </p>
              </div>

              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
                    CapSolver
                  </span>
                  {hasCapSolver && <span className="text-[11px] text-green-600 font-medium">Activa</span>}
                </div>
                <input
                  type="password"
                  placeholder={hasCapSolver ? "Cheie noua..." : "cheia capsolver.com..."}
                  value={keyInputs.capsolver}
                  onChange={(e) => setKeyInputs({ ...keyInputs, capsolver: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                {hasCapSolver && (
                  <button className="mt-1.5 text-[11px] text-red-500 hover:underline" onClick={() => { clearKey("capsolver"); }}>
                    Sterge cheia
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  ~$0.0008/captcha, AI-based.
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" size="sm" onClick={closeKeyDialog}>
                {hasKey ? "Inchide" : "Mai tarziu"}
              </Button>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={handleSaveKeys}
                disabled={!keyInputs.anthropic.trim() && !keyInputs.openai.trim() && !keyInputs.google.trim() && !keyInputs.twocaptcha.trim() && !keyInputs.capsolver.trim()}
              >
                Salveaza
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Cheile se salveaza doar local pe calculatorul tau si sunt trimise doar catre API-urile respective.
            </p>
          </div>
        </div>
      )}
      </ConfirmProvider>
    </BrowserRouter>
  );
}
