import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { AdminGate } from "@/components/AdminGate";
import { AIUsagePanel } from "@/components/AIUsagePanel";
import { ApiAccessPanel } from "@/components/ApiAccessPanel";
import { EmailSettingsPanel } from "@/components/EmailSettingsPanel";
import { NotificationStatusPanel } from "@/components/NotificationStatusPanel";
import { TenantKeyStatusPanel } from "@/components/TenantKeyStatusPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";

// v2.42.0 (5.1): pagina /setari pe roluri, cu taburi via query `?tab=`.
// "General" e pentru toti; taburile admin refolosesc componentele de pagina
// existente cu prop `embedded` (fara shell/h1 propriu), montate ON-DEMAND
// (doar tabul activ exista in DOM) si impachetate in AdminGate. Rutele
// /admin/* raman functionale, doar nu mai apar in sidebar (web).

const AdminUsers = lazy(() => import("@/pages/admin/Users"));
const AdminKeys = lazy(() => import("@/pages/admin/Keys"));
const AdminQuota = lazy(() => import("@/pages/admin/Quota"));
const AdminGrants = lazy(() => import("@/pages/admin/Grants"));
const AdminUsage = lazy(() => import("@/pages/admin/Usage"));
const AdminAudit = lazy(() => import("@/pages/admin/Audit"));

const TABS = [
  { key: "general", label: "General", adminOnly: false },
  { key: "utilizatori", label: "Utilizatori", adminOnly: true },
  { key: "chei", label: "Chei API", adminOnly: true },
  { key: "cote", label: "Cote", adminOnly: true },
  { key: "granturi", label: "Granturi", adminOnly: true },
  { key: "consum", label: "Consum", adminOnly: true },
  { key: "audit", label: "Audit", adminOnly: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTabKey(v: string | null): v is TabKey {
  return TABS.some((t) => t.key === v);
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin";

  const rawTab = searchParams.get("tab");
  const requested: TabKey = isTabKey(rawTab) ? rawTab : "general";
  // Non-adminul nu poate ateriza pe un tab admin din URL — cade pe General
  // (gate-ul serverului ramane autoritatea; asta e doar UX).
  const activeTab: TabKey = !isAdmin && requested !== "general" ? "general" : requested;

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // replace:true — schimbarea tabului nu adauga intrari in istoricul
  // browserului (Back iese din Setari, nu plimba prin taburi).
  const selectTab = (key: TabKey) => {
    setSearchParams(key === "general" ? {} : { tab: key }, { replace: true });
  };

  const fallback = <p className="px-4 py-8 text-center text-sm text-muted-foreground">Se incarca…</p>;

  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <SettingsIcon className="h-6 w-6 text-primary" />
            Setari
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Setarile tale si administrarea aplicatiei, intr-un singur loc."
              : "Setarile contului tau. Cheile API sunt gestionate de administrator."}
          </p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Sectiuni de setari">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => selectTab(tab.key)}
              className={cn(
                "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "general" && (
          <div className="max-w-5xl">
            <TenantKeyStatusPanel onManageKeys={() => selectTab("chei")} />
            <AIUsagePanel />
            <NotificationStatusPanel />
            <EmailSettingsPanel />
            {isAdmin && <ApiAccessPanel />}
          </div>
        )}

        {activeTab === "utilizatori" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminUsers embedded />
            </Suspense>
          </AdminGate>
        )}
        {activeTab === "chei" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminKeys embedded />
            </Suspense>
          </AdminGate>
        )}
        {activeTab === "cote" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminQuota embedded />
            </Suspense>
          </AdminGate>
        )}
        {activeTab === "granturi" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminGrants embedded />
            </Suspense>
          </AdminGate>
        )}
        {activeTab === "consum" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminUsage embedded />
            </Suspense>
          </AdminGate>
        )}
        {activeTab === "audit" && (
          <AdminGate>
            <Suspense fallback={fallback}>
              <AdminAudit embedded />
            </Suspense>
          </AdminGate>
        )}
      </div>
    </div>
  );
}
