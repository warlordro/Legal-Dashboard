import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Scale, Search, CalendarDays, BarChart3, Moon, Sun, PanelLeftClose, PanelLeftOpen, History, Trash2, FileSearch, Clock, X, AArrowUp, AArrowDown, Type, Key, Bot, FileLock2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useFontSize } from "@/hooks/useFontSize";
import { Button } from "./ui/button";
import type { SearchHistoryEntry, SearchParams } from "@/types";
import type { RnpmSearchHistoryEntry, RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";

const navItems = [
  { to: "/", label: "Dashboard", icon: BarChart3, end: true },
  { to: "/dosare", label: "Cautare Dosare", icon: Search },
  { to: "/termene", label: "Termene & Calendar", icon: CalendarDays },
  { to: "/rnpm", label: "Cautare RNPM", icon: FileLock2 },
];

interface SidebarProps {
  history: SearchHistoryEntry[];
  onHistoryClick: (type: "dosare" | "termene", params: SearchParams) => void;
  onRemoveEntry: (id: string) => void;
  onClearHistory: () => void;
  hasApiKey?: boolean;
  onConfigureApiKey?: () => void;
  rnpmHistory: RnpmSearchHistoryEntry[];
  onRnpmHistoryClick: (type: RnpmSearchType, params: RnpmSearchParams) => void;
  onRnpmRemoveEntry: (id: string) => void;
  onRnpmClearHistory: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "acum";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}z`;
}

export function Sidebar({ history, onHistoryClick, onRemoveEntry, onClearHistory, hasApiKey, onConfigureApiKey, rnpmHistory, onRnpmHistoryClick, onRnpmRemoveEntry, onRnpmClearHistory }: SidebarProps) {
  const { theme, toggle } = useTheme();
  const fontSize = useFontSize();
  const [collapsed, setCollapsed] = useState(false);
  const [openHistory, setOpenHistory] = useState<"cautari" | "rnpm" | null>("cautari");
  const [popoverSection, setPopoverSection] = useState<"cautari" | "rnpm" | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverBtnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const handleEntryClick = (entry: SearchHistoryEntry) => {
    setPopoverSection(null);
    onHistoryClick(entry.type, entry.params);
    navigate(entry.type === "dosare" ? "/dosare" : "/termene");
  };

  const handleRnpmEntryClick = (entry: RnpmSearchHistoryEntry) => {
    setPopoverSection(null);
    onRnpmHistoryClick(entry.type, entry.params);
    navigate("/rnpm");
  };

  // Close popover on outside click
  useEffect(() => {
    if (!popoverSection) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        popoverBtnRef.current && !popoverBtnRef.current.contains(e.target as Node)
      ) {
        setPopoverSection(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverSection]);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Header: Logo */}
      <div className="flex items-center border-b border-border px-3 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Scale className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-bold leading-tight whitespace-nowrap">Legal</p>
            <p className="text-xs text-muted-foreground whitespace-nowrap">Dashboard</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="space-y-1 p-2">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-lg text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="whitespace-nowrap overflow-hidden">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* History accordion: only one section open at a time */}
      {!collapsed && (history.length > 0 || rnpmHistory.length > 0) && (
        <div className="flex flex-1 flex-col overflow-hidden border-t border-border">
          {/* Cautari section */}
          {history.length > 0 && (
            <div className={cn("flex flex-col overflow-hidden", openHistory === "cautari" && "flex-1")}>
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <button
                  type="button"
                  onClick={() => setOpenHistory(openHistory === "cautari" ? null : "cautari")}
                  className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  {openHistory === "cautari" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <History className="h-3 w-3" />
                  Istoric Cautari
                </button>
                {openHistory === "cautari" && (
                  <button
                    type="button"
                    onClick={onClearHistory}
                    title="Sterge istoricul"
                    className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {openHistory === "cautari" && (
                <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
                  {history.map((entry) => (
                    <div key={entry.id} className="group relative flex items-start rounded-md transition-colors hover:bg-accent">
                      <button
                        type="button"
                        onClick={() => handleEntryClick(entry)}
                        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
                      >
                        <div className="mt-0.5 shrink-0">
                          {entry.type === "dosare" ? (
                            <FileSearch className="h-3 w-3 text-blue-500" />
                          ) : (
                            <CalendarDays className="h-3 w-3 text-purple-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-foreground group-hover:text-primary">
                            {entry.label}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>{entry.resultCount} rez.</span>
                            <span>·</span>
                            <Clock className="h-2.5 w-2.5" />
                            <span>{formatTimeAgo(entry.timestamp)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveEntry(entry.id); }}
                        title="Sterge"
                        className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-red-500 group-hover:block"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* RNPM section */}
          {rnpmHistory.length > 0 && (
            <div className={cn("flex flex-col overflow-hidden border-t border-border", openHistory === "rnpm" && "flex-1")}>
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <button
                  type="button"
                  onClick={() => setOpenHistory(openHistory === "rnpm" ? null : "rnpm")}
                  className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  {openHistory === "rnpm" ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <History className="h-3 w-3" />
                  Istoric RNPM
                </button>
                {openHistory === "rnpm" && (
                  <button
                    type="button"
                    onClick={onRnpmClearHistory}
                    title="Sterge istoricul RNPM"
                    className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-red-500"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {openHistory === "rnpm" && (
                <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
                  {rnpmHistory.map((entry) => (
                    <div key={entry.id} className="group relative flex items-start rounded-md transition-colors hover:bg-accent">
                      <button
                        type="button"
                        onClick={() => handleRnpmEntryClick(entry)}
                        className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
                      >
                        <FileLock2 className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-foreground group-hover:text-primary">
                            {entry.label}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>{entry.resultCount} rez.</span>
                            <span>·</span>
                            <Clock className="h-2.5 w-2.5" />
                            <span>{formatTimeAgo(entry.timestamp)}</span>
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRnpmRemoveEntry(entry.id); }}
                        title="Sterge"
                        className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-red-500 group-hover:block"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed: history popovers (Cautari + RNPM) */}
      {collapsed && (history.length > 0 || rnpmHistory.length > 0) && (
        <div className="relative flex-1 flex flex-col items-center gap-1 pt-2 border-t border-border">
          {history.length > 0 && (
            <button
              ref={popoverSection === "cautari" ? popoverBtnRef : null}
              type="button"
              onClick={() => setPopoverSection(popoverSection === "cautari" ? null : "cautari")}
              title="Istoric cautari"
              className={cn(
                "rounded-lg p-2 transition-colors",
                popoverSection === "cautari"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <History className="h-4 w-4" />
            </button>
          )}

          {rnpmHistory.length > 0 && (
            <button
              ref={popoverSection === "rnpm" ? popoverBtnRef : null}
              type="button"
              onClick={() => setPopoverSection(popoverSection === "rnpm" ? null : "rnpm")}
              title="Istoric RNPM"
              className={cn(
                "rounded-lg p-2 transition-colors",
                popoverSection === "rnpm"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <FileLock2 className="h-4 w-4" />
            </button>
          )}

          {popoverSection === "cautari" && (
            <div
              ref={popoverRef}
              className="absolute left-full top-0 z-50 ml-2 w-56 rounded-xl border border-border bg-card shadow-xl animate-in fade-in slide-in-from-left-2 duration-200"
            >
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <History className="h-3 w-3" />
                  Istoric Cautari
                </span>
                <button
                  type="button"
                  onClick={() => { onClearHistory(); setPopoverSection(null); }}
                  title="Sterge istoricul"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-red-500"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="overflow-y-auto scrollbar-thin px-2 pb-2" style={{ maxHeight: "60vh" }}>
                {history.map((entry) => (
                  <div key={entry.id} className="group relative flex items-start rounded-md transition-colors hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => handleEntryClick(entry)}
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
                    >
                      <div className="mt-0.5 shrink-0">
                        {entry.type === "dosare" ? (
                          <FileSearch className="h-3 w-3 text-blue-500" />
                        ) : (
                          <CalendarDays className="h-3 w-3 text-purple-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground group-hover:text-primary">
                          {entry.label}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{entry.resultCount} rez.</span>
                          <span>·</span>
                          <Clock className="h-2.5 w-2.5" />
                          <span>{formatTimeAgo(entry.timestamp)}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRemoveEntry(entry.id); }}
                      title="Sterge"
                      className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-red-500 group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {popoverSection === "rnpm" && (
            <div
              ref={popoverRef}
              className="absolute left-full top-0 z-50 ml-2 w-56 rounded-xl border border-border bg-card shadow-xl animate-in fade-in slide-in-from-left-2 duration-200"
            >
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <History className="h-3 w-3" />
                  Istoric RNPM
                </span>
                <button
                  type="button"
                  onClick={() => { onRnpmClearHistory(); setPopoverSection(null); }}
                  title="Sterge istoricul RNPM"
                  className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-red-500"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="overflow-y-auto scrollbar-thin px-2 pb-2" style={{ maxHeight: "60vh" }}>
                {rnpmHistory.map((entry) => (
                  <div key={entry.id} className="group relative flex items-start rounded-md transition-colors hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => handleRnpmEntryClick(entry)}
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left"
                    >
                      <FileLock2 className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground group-hover:text-primary">
                          {entry.label}
                        </p>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{entry.resultCount} rez.</span>
                          <span>·</span>
                          <Clock className="h-2.5 w-2.5" />
                          <span>{formatTimeAgo(entry.timestamp)}</span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRnpmRemoveEntry(entry.id); }}
                      title="Sterge"
                      className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-red-500 group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spacer when no history */}
      {history.length === 0 && rnpmHistory.length === 0 && <div className="flex-1" />}

      {/* Footer */}
      <div className="border-t border-border p-2 space-y-1">
        {/* Font size control */}
        {collapsed ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={fontSize.cycle}
            title={`Dimensiune text: ${fontSize.label} (${fontSize.value}px)`}
            className="w-full justify-center p-2 h-10 text-muted-foreground"
          >
            <Type className="h-5 w-5 shrink-0" />
          </Button>
        ) : (
          <div className="flex items-center gap-1 rounded-lg px-1 py-0.5">
            <Type className="h-4 w-4 shrink-0 text-muted-foreground ml-2" />
            <span className="text-[12px] font-medium text-muted-foreground ml-1 min-w-[38px]">
              {fontSize.label}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={fontSize.decrease}
                disabled={!fontSize.canDecrease}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="Micsoreaza textul"
              >
                <AArrowDown className="h-3.5 w-3.5" />
              </button>
              {fontSize.steps.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => fontSize.setStep(i)}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-all",
                    i === fontSize.step
                      ? "bg-primary scale-125"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  )}
                  title={`${s.label} (${s.value}px)`}
                />
              ))}
              <button
                type="button"
                onClick={fontSize.increase}
                disabled={!fontSize.canIncrease}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                title="Mareste textul"
              >
                <AArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={onConfigureApiKey}
          title={collapsed ? "Setari API" : undefined}
          className={cn(
            "w-full text-muted-foreground",
            collapsed ? "justify-center p-2 h-10" : "justify-start gap-3"
          )}
        >
          <Bot className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4", hasApiKey ? "text-green-500" : "text-muted-foreground")} />
          {!collapsed && (
            <span className="flex items-center gap-2">
              Setari API
              {hasApiKey ? (
                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Activ</span>
              ) : (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Neconfigurat</span>
              )}
            </span>
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          title={collapsed ? (theme === "dark" ? "Mod Luminos" : "Mod Inchis") : undefined}
          className={cn(
            "w-full text-muted-foreground",
            collapsed ? "justify-center p-2 h-10" : "justify-start gap-3"
          )}
        >
          {theme === "dark" ? <Sun className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} /> : <Moon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />}
          {!collapsed && (theme === "dark" ? "Mod Luminos" : "Mod Inchis")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Deschide meniu" : "Inchide meniu"}
          className={cn(
            "w-full",
            collapsed ? "justify-center p-2 h-10 border-primary/30 text-primary hover:bg-primary/10" : "justify-start gap-3 text-muted-foreground"
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-5 w-5 shrink-0" />
            : <PanelLeftClose className="h-4 w-4 shrink-0" />
          }
          {!collapsed && "Inchide meniu"}
        </Button>

      </div>
    </aside>
  );
}
