// PR-A (v2.7.0) — banda de Quick Actions sub KPI strip pe Dashboard.
//
// 6 butoane catre fluxurile principale ale aplicatiei. Folosim react-router
// <Link>-uri ca sa pastram istoricul navigatiei (back/forward functioneaza).
// PR-C (v2.9.0): "Export raport" deschide modalul ReportExportModal — picker
// de interval (7d/30d) + format (XLSX/PDF), worker-driven build.

import { useState } from "react";
import { Link } from "react-router-dom";
import { FileSearch, Bell, CalendarDays, Search, ListChecks, FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReportExportModal } from "./ReportExportModal";

interface QuickAction {
  to?: string;
  icon: typeof FileSearch;
  label: string;
  iconColor: string;
  iconBg: string;
  onClick?: () => void;
}

export function QuickActions() {
  const [reportOpen, setReportOpen] = useState(false);

  const actions: QuickAction[] = [
    { to: "/dosare", icon: FileSearch, label: "Cauta dosar", iconColor: "text-blue-500", iconBg: "bg-blue-500/10" },
    {
      to: "/termene",
      icon: CalendarDays,
      label: "Vezi termene",
      iconColor: "text-purple-500",
      iconBg: "bg-purple-500/10",
    },
    { to: "/rnpm", icon: Search, label: "Cauta RNPM", iconColor: "text-emerald-500", iconBg: "bg-emerald-500/10" },
    {
      to: "/monitorizare",
      icon: ListChecks,
      label: "Monitorizare",
      iconColor: "text-blue-600",
      iconBg: "bg-blue-600/10",
    },
    { to: "/alerte", icon: Bell, label: "Vezi alerte", iconColor: "text-amber-500", iconBg: "bg-amber-500/10" },
    {
      icon: FileDown,
      label: "Export raport",
      iconColor: "text-slate-500",
      iconBg: "bg-slate-500/10",
      onClick: () => setReportOpen(true),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Actiuni rapide
          </CardTitle>
          <CardDescription className="text-xs">Acces direct la fluxurile principale ale aplicatiei.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {actions.map((action) => {
              const Icon = action.icon;
              const inner = (
                <span className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 text-center text-xs transition-colors hover:bg-muted/40">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", action.iconBg)}>
                    <Icon className={cn("h-4 w-4", action.iconColor)} />
                  </span>
                  <span className="font-medium leading-tight">{action.label}</span>
                </span>
              );
              if (action.onClick) {
                return (
                  <button key={action.label} type="button" onClick={action.onClick} className="block w-full text-left">
                    {inner}
                  </button>
                );
              }
              if (!action.to) return null;
              return (
                <Link key={action.to} to={action.to} className="block">
                  {inner}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <ReportExportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
