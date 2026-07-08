import { Moon, Sun, PanelLeftClose, PanelLeftOpen, Type, AArrowUp, AArrowDown, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { useFontSize } from "@/hooks/useFontSize";
import { useTenantKeyStatus } from "@/hooks/useTenantKeyStatus";
import { Button } from "./ui/button";

export interface SidebarFooterProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hasApiKey?: boolean;
  onConfigureApiKey?: () => void;
}

export function SidebarFooter({ collapsed, onToggleCollapsed, hasApiKey, onConfigureApiKey }: SidebarFooterProps) {
  const { theme, toggle } = useTheme();
  const fontSize = useFontSize();
  const tenant = useTenantKeyStatus();
  // v2.42.0 (5.1): in web intrarea se numeste "Setari" si duce la /setari
  // (handler-ul vine din Sidebar); pe desktop ramane "Setari API" + dialog BYOK.
  const isWeb = typeof window !== "undefined" && !window.desktopApi;
  const settingsLabel = isWeb ? "Setari" : "Setari API";
  // Badge-ul de chei: pe desktop reflecta cheile locale (hasApiKey); in web
  // reflecta cheile tenant (server). Cat timp starea e loading/error NU
  // afirmam nimic (nici "Activ" fals care ar masca o eroare persistenta,
  // nici "Neconfigurat" fals care ar alarma degeaba) — badge-ul lipseste.
  const keyStateKnown = tenant.state.state === "desktop" || tenant.state.state === "ready";
  const effectiveHasKey = tenant.state.state === "ready" ? tenant.hasTenantAiKey : hasApiKey;

  return (
    <div className="shrink-0 border-t border-border p-2 space-y-1">
      {/* Font size control */}
      {collapsed ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={fontSize.cycle}
          title={`Dimensiune text: ${fontSize.label} (${fontSize.value}px)`}
          className="w-full justify-center p-2 h-10 text-muted-foreground"
        >
          <Type className="h-[18px] w-[18px] shrink-0" />
        </Button>
      ) : (
        <div className="flex items-center gap-1 rounded-lg px-1 py-0.5">
          <Type className="h-4 w-4 shrink-0 text-muted-foreground ml-2" />
          <span className="text-[12px] font-medium text-muted-foreground ml-1 min-w-[38px]">{fontSize.label}</span>
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
                  i === fontSize.step ? "bg-primary scale-125" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
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
        title={collapsed ? settingsLabel : undefined}
        className={cn("w-full text-muted-foreground", collapsed ? "justify-center p-2 h-10" : "justify-start gap-3")}
      >
        <Bot
          className={cn(
            "shrink-0",
            collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
            keyStateKnown && effectiveHasKey ? "text-green-500" : "text-muted-foreground"
          )}
        />
        {!collapsed && (
          <span className="flex items-center gap-2">
            {settingsLabel}
            {keyStateKnown &&
              (effectiveHasKey ? (
                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Activ
                </span>
              ) : (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  Neconfigurat
                </span>
              ))}
          </span>
        )}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        title={collapsed ? (theme === "dark" ? "Mod Luminos" : "Mod Inchis") : undefined}
        className={cn("w-full text-muted-foreground", collapsed ? "justify-center p-2 h-10" : "justify-start gap-3")}
      >
        {theme === "dark" ? (
          <Sun className={cn("shrink-0", collapsed ? "h-[18px] w-[18px]" : "h-4 w-4")} />
        ) : (
          <Moon className={cn("shrink-0", collapsed ? "h-[18px] w-[18px]" : "h-4 w-4")} />
        )}
        {!collapsed && (theme === "dark" ? "Mod Luminos" : "Mod Inchis")}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onToggleCollapsed}
        title={collapsed ? "Deschide meniu" : "Inchide meniu"}
        className={cn(
          "w-full",
          collapsed
            ? "justify-center p-2 h-10 border-primary/30 text-primary hover:bg-primary/10"
            : "justify-start gap-3 text-muted-foreground"
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" />
        ) : (
          <PanelLeftClose className="h-4 w-4 shrink-0" />
        )}
        {!collapsed && "Inchide meniu"}
      </Button>
    </div>
  );
}
