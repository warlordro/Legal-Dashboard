import { useState, useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Scale, Search, CalendarDays, BarChart3, History, Trash2, FileSearch, FileLock2, ChevronDown, ChevronRight, Activity, Bell, Users as UsersIcon, ClipboardList, Gauge, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchHistoryEntry, SearchParams } from "@/types";
import type { RnpmSearchHistoryEntry, RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";
import { HistoryEntryRow } from "./sidebar-history-entry";
import { SidebarFooter } from "./sidebar-footer";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const navItems = [
  { to: "/", label: "Dashboard", icon: BarChart3, end: true },
  { to: "/dosare", label: "Cautare Dosare", icon: Search },
  { to: "/termene", label: "Termene & Calendar", icon: CalendarDays },
  { to: "/rnpm", label: "Cautare RNPM", icon: FileLock2 },
  { to: "/monitorizare", label: "Monitorizare", icon: Activity },
  { to: "/alerte", label: "Alerte", icon: Bell },
];

const adminNavItems = [
  { to: "/admin/users", label: "Utilizatori", icon: UsersIcon },
  { to: "/admin/audit", label: "Audit", icon: ClipboardList },
  { to: "/admin/quota", label: "Cote", icon: Gauge },
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
  unreadAlerts?: number;
}

function cautariIcon(type: SearchHistoryEntry["type"]) {
  return type === "dosare"
    ? <FileSearch className="h-3 w-3 text-blue-500" />
    : <CalendarDays className="h-3 w-3 text-purple-500" />;
}

const rnpmIcon = <FileLock2 className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />;

export function Sidebar({ history, onHistoryClick, onRemoveEntry, onClearHistory, hasApiKey, onConfigureApiKey, rnpmHistory, onRnpmHistoryClick, onRnpmRemoveEntry, onRnpmClearHistory, unreadAlerts = 0 }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Open the section whose most recent entry is newest — so reopening the app
  // lands on whichever category the user was last active in.
  const [openHistory, setOpenHistory] = useState<"cautari" | "rnpm" | null>(() => {
    const latestCautari = history[0]?.timestamp ?? 0;
    const latestRnpm = rnpmHistory[0]?.timestamp ?? 0;
    return latestRnpm > latestCautari ? "rnpm" : "cautari";
  });
  const [popoverSection, setPopoverSection] = useState<"cautari" | "rnpm" | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverBtnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  // v2.18.1: in desktop mode utilizatorul `local` e auto-promovat la admin la
  // boot (vezi backend/src/index.ts), strict pentru a putea folosi rutele
  // /api/v1/admin/* din modalul "Info baza locala" (sterge tot, compact, backups).
  // Nu vrem sa expunem si UI-ul multi-tenant (Utilizatori/Audit/Cote) pentru
  // single-user desktop — e zgomot vizual fara valoare. Ascundem sectiunea cand
  // window.desktopApi e prezent (= rulam in Electron).
  const isDesktop = typeof window !== "undefined" && !!window.desktopApi;
  const isAdmin = user?.role === "admin" && !isDesktop;

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
        "flex h-full flex-col border-r border-border bg-card transition-all duration-300",
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
        {navItems.map(({ to, label, icon: Icon, end }) => {
          const showBadge = to === "/alerte" && unreadAlerts > 0;
          const badgeText = unreadAlerts > 99 ? "99+" : String(unreadAlerts);
          return (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                "relative flex items-center rounded-lg text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 whitespace-nowrap overflow-hidden">{label}</span>
                {showBadge && (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-card">
                    {badgeText}
                  </span>
                )}
              </>
            )}
            {collapsed && showBadge && (
              <span className="absolute right-0 top-0 inline-flex min-w-4 translate-x-0.5 -translate-y-0.5 items-center justify-center rounded-full bg-red-600 px-1 py-0.5 text-[9px] font-bold leading-none text-white shadow-sm ring-2 ring-card">
                {badgeText}
              </span>
            )}
          </NavLink>
          );
        })}
      </nav>

      {/* Admin section — gated on role; hidden completely otherwise so non-admins
          never see the entries. The same role is re-checked server-side on every
          /api/v1/admin/* call, so this is purely cosmetic. */}
      {isAdmin && (
        <nav className="space-y-1 border-t border-border p-2">
          {!collapsed && (
            <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Administrare
            </div>
          )}
          {adminNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center rounded-lg text-sm font-medium transition-colors",
                  collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && (
                <span className="min-w-0 flex-1 whitespace-nowrap overflow-hidden">{label}</span>
              )}
            </NavLink>
          ))}
        </nav>
      )}

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
                    <HistoryEntryRow
                      key={entry.id}
                      icon={cautariIcon(entry.type)}
                      label={entry.label}
                      resultCount={entry.resultCount}
                      timestamp={entry.timestamp}
                      onClick={() => handleEntryClick(entry)}
                      onRemove={() => onRemoveEntry(entry.id)}
                    />
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
                    <HistoryEntryRow
                      key={entry.id}
                      icon={rnpmIcon}
                      label={entry.label}
                      resultCount={entry.resultCount}
                      timestamp={entry.timestamp}
                      onClick={() => handleRnpmEntryClick(entry)}
                      onRemove={() => onRnpmRemoveEntry(entry.id)}
                    />
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
                  <HistoryEntryRow
                    key={entry.id}
                    icon={cautariIcon(entry.type)}
                    label={entry.label}
                    resultCount={entry.resultCount}
                    timestamp={entry.timestamp}
                    onClick={() => handleEntryClick(entry)}
                    onRemove={() => onRemoveEntry(entry.id)}
                  />
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
                  <HistoryEntryRow
                    key={entry.id}
                    icon={rnpmIcon}
                    label={entry.label}
                    resultCount={entry.resultCount}
                    timestamp={entry.timestamp}
                    onClick={() => handleRnpmEntryClick(entry)}
                    onRemove={() => onRnpmRemoveEntry(entry.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spacer when no history */}
      {history.length === 0 && rnpmHistory.length === 0 && <div className="flex-1" />}

      <SidebarFooter
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        hasApiKey={hasApiKey}
        onConfigureApiKey={onConfigureApiKey}
      />
    </aside>
  );
}
