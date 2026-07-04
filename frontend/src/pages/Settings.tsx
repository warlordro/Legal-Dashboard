import { Settings as SettingsIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AIUsagePanel } from "@/components/AIUsagePanel";
import { AdminGate } from "@/components/AdminGate";
import { ApiAccessPanel } from "@/components/ApiAccessPanel";
import { EmailSettingsPanel } from "@/components/EmailSettingsPanel";
import { TenantKeyStatusPanel } from "@/components/TenantKeyStatusPanel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TenantKeys } from "@/hooks/useTenantKeyStatus";
import { cn } from "@/lib/utils";
import AdminAudit from "@/pages/admin/Audit";
import AdminGrants from "@/pages/admin/Grants";
import AdminKeys from "@/pages/admin/Keys";
import AdminQuota from "@/pages/admin/Quota";
import AdminUsage from "@/pages/admin/Usage";
import AdminUsers from "@/pages/admin/Users";

// v2.42.0 (PLAN-web-ux-etapa2.md, E2-B): pagina "Setari" — web-only, tab-uri pe
// rol. Sectiunea Administrare dispare din sidebar; totul sta aici. Desktop nu
// monteaza ruta (pastreaza dialogul BYOK). Tab-ul activ traieste in ?tab= ca
// deep-link-urile si refresh-ul sa pastreze starea.

type TabId = "general" | "utilizatori" | "chei" | "cote" | "granturi" | "consum" | "audit";

const TABS: Array<{ id: TabId; label: string; adminOnly: boolean }> = [
  { id: "general", label: "General", adminOnly: false },
  { id: "utilizatori", label: "Utilizatori", adminOnly: true },
  { id: "chei", label: "Chei API", adminOnly: true },
  { id: "cote", label: "Cote", adminOnly: true },
  { id: "granturi", label: "Granturi", adminOnly: true },
  { id: "consum", label: "Consum", adminOnly: true },
  { id: "audit", label: "Audit", adminOnly: true },
];

export default function SettingsPage({ tenantKeys }: { tenantKeys: TenantKeys }) {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("tab") as TabId | null;
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  // Non-adminul cu un deep-link spre un tab admin cade pe General (serverul
  // ramane oricum autoritativ — AdminGate + requireRole).
  const tab: TabId = visibleTabs.some((t) => t.id === requested) ? (requested as TabId) : "general";

  const selectTab = (id: TabId) => {
    setSearchParams(id === "general" ? {} : { tab: id }, { replace: true });
  };

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

        <div className="flex flex-wrap gap-1 border-b border-border">
          {visibleTabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              className={cn(
                "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Se randeaza DOAR tab-ul activ (mount-on-demand) — fara fetch-uri
            eager pe toate paginile admin la deschiderea Setarilor. */}
        {tab === "general" && (
          <div className="max-w-5xl">
            <TenantKeyStatusPanel
              tenantKeys={tenantKeys}
              isAdmin={isAdmin === true}
              onManageKeys={() => selectTab("chei")}
            />
            <AIUsagePanel />
            <EmailSettingsPanel />
            {isAdmin && <ApiAccessPanel />}
          </div>
        )}
        {tab === "utilizatori" && (
          <AdminGate>
            <AdminUsers embedded />
          </AdminGate>
        )}
        {tab === "chei" && (
          <AdminGate>
            <AdminKeys embedded />
          </AdminGate>
        )}
        {tab === "cote" && (
          <AdminGate>
            <AdminQuota embedded />
          </AdminGate>
        )}
        {tab === "granturi" && (
          <AdminGate>
            <AdminGrants embedded />
          </AdminGate>
        )}
        {tab === "consum" && (
          <AdminGate>
            <AdminUsage embedded />
          </AdminGate>
        )}
        {tab === "audit" && (
          <AdminGate>
            <AdminAudit embedded />
          </AdminGate>
        )}
      </div>
    </div>
  );
}
