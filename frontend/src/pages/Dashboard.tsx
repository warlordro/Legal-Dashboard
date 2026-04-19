import { useCallback, useState } from "react";
import { Scale, FileSearch, CalendarDays, ArrowRight, ScrollText, BookOpen } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/hooks/useDialog";
import type { Dosar, SearchHistoryEntry, SearchParams } from "@/types";
import type { RnpmSearchHistoryEntry } from "@/types/rnpm";
import { LastDosareCard, LastRnpmCard } from "./dashboard-summary-cards";
import { ChangelogDialog, ManualDialog } from "./dashboard-modals";

const APP_VERSION = `v${__APP_VERSION__}`;

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
  lastSearchParams?: SearchParams;
}

interface DashboardProps {
  dosareState: DosareState;
  rnpmHistory: RnpmSearchHistoryEntry[];
  history: SearchHistoryEntry[];
  onHistoryClick: (type: "dosare" | "termene", params: SearchParams) => void;
}

const features = [
  {
    icon: FileSearch,
    title: "Cautare Dosare",
    description:
      "Cauta dosare dupa numar, parti implicate sau obiectul cauzei. Filtrare dupa tip instanta si institutie.",
    to: "/dosare",
    badges: ["Penal", "Civil", "Contencios adm.", "Litigii munca", "Faliment", "Profesionisti", "Altele"],
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: CalendarDays,
    title: "Termene & Calendar",
    description:
      "Vizualizeaza termene viitoare, istoricul sedintelor si solutiile pronuntate. Export pentru planificare.",
    to: "/termene",
    badges: ["Penal", "Civil", "Contencios adm.", "Litigii munca", "Faliment", "Profesionisti", "Altele"],
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
];

const tipuriProces = [
  { label: "Penal", desc: "Dosare penale, infractiuni", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  { label: "Civil", desc: "Litigii civile, proprietate, familie", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { label: "Contencios administrativ si fiscal", desc: "Litigii cu autoritati publice", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { label: "Litigii de munca", desc: "Conflicte de munca, salarii", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  { label: "Faliment", desc: "Proceduri de faliment si lichidare", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { label: "Litigii cu profesionistii", desc: "Litigii comerciale intre profesionisti", color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400" },
  { label: "Altele", desc: "Alte categorii de cauze", color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400" },
];

function getUniqueCategories(dosare: Dosar[]): string[] {
  const cats = new Set<string>();
  for (const d of dosare) {
    if (d.categorieCaz) cats.add(d.categorieCaz);
  }
  return Array.from(cats);
}

function getUniqueInstitutii(dosare: Dosar[]): number {
  const set = new Set<string>();
  for (const d of dosare) {
    if (d.institutie) set.add(d.institutie);
  }
  return set.size;
}

export default function Dashboard({ dosareState, rnpmHistory, history, onHistoryClick }: DashboardProps) {
  const navigate = useNavigate();
  const [showChangelog, setShowChangelog] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [isDownloadingManual, setIsDownloadingManual] = useState(false);
  const hasDosareData = dosareState.searched && dosareState.allDosare.length > 0;
  const lastDosareEntry = history.find((e) => e.type === "dosare");
  // Live state wins; fall back to persisted history entry after restart.
  const dosareCard = hasDosareData
    ? {
        count: dosareState.allDosare.length,
        categoriesCount: getUniqueCategories(dosareState.allDosare).length,
        institutiiCount: getUniqueInstitutii(dosareState.allDosare),
        searchedName: dosareState.searchedName,
        params: dosareState.lastSearchParams ?? null,
      }
    : lastDosareEntry
      ? {
          count: lastDosareEntry.resultCount,
          categoriesCount: lastDosareEntry.meta?.categoriesCount ?? 0,
          institutiiCount: lastDosareEntry.meta?.institutiiCount ?? 0,
          searchedName: lastDosareEntry.params.numeParte,
          params: lastDosareEntry.params,
        }
      : null;
  const handleOpenDosare = () => {
    // When live data exists, just navigate — Dosare still has it in state.
    // When falling back to history, re-run the search so the user lands on filled results.
    if (!hasDosareData && dosareCard?.params) onHistoryClick("dosare", dosareCard.params);
    navigate("/dosare");
  };
  const lastRnpm = rnpmHistory[0];

  const closeChangelog = useCallback(() => setShowChangelog(false), []);
  const closeManual = useCallback(() => setShowManual(false), []);
  const changelogRef = useDialog<HTMLDivElement>(showChangelog, closeChangelog);
  const manualRef = useDialog<HTMLDivElement>(showManual, closeManual);

  const handleDownloadManualPdf = async () => {
    setIsDownloadingManual(true);
    try {
      // Dynamic import keeps jspdf/xlsx out of the initial Dashboard chunk.
      const { exportManualPDF } = await import("@/lib/export");
      await exportManualPDF();
    } finally {
      setIsDownloadingManual(false);
    }
  };

  return (
    <div className="space-y-8 p-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
          <Scale className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Legal Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Acces rapid la dosarele si termenele din instantele romanesti prin API-ul public al Ministerului Justitiei.
          </p>
        </div>
      </div>

      {dosareCard && (
        <LastDosareCard
          count={dosareCard.count}
          categoriesCount={dosareCard.categoriesCount}
          institutiiCount={dosareCard.institutiiCount}
          searchedName={dosareCard.searchedName}
          onOpen={handleOpenDosare}
        />
      )}

      {lastRnpm && <LastRnpmCard entry={lastRnpm} />}

      {/* Feature cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, description, to, badges, color, bg }) => (
          <Card key={to} className="group hover:shadow-md transition-shadow">
            <CardHeader>
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {badges.map((b) => (
                  <Badge key={b} variant="secondary">
                    {b}
                  </Badge>
                ))}
              </div>
              <Link
                to={to}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Deschide <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tipuri de procese */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tipuri de Procese Disponibile
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tipuriProces.map(({ label, desc, color }) => (
            <div key={label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{label}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* API Info + Version */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">Informatii API</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span>Web Service SOAP: <code className="text-foreground">http://portalquery.just.ro/query.asmx</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span>Metode disponibile: <code className="text-foreground">CautareDosare</code>, <code className="text-foreground">CautareTermene</code></span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-purple-500" />
                <span>Limita rezultate: max. 1000 inregistrari per cerere</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span>Autentificare: nu este necesara (API public)</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">Versiune Aplicatie</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400 text-sm font-bold px-3 py-1">
                  {APP_VERSION}
                </Badge>
                <span className="text-xs text-muted-foreground">AI Enabled</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Modul RNPM complet (avize, creditori, debitori, bunuri, istoric), analiza AI multi-agent (Claude 4.6 / Gemini 3.x / GPT-5.4) si audit de securitate — cheile API pastrate in OS keystore, backend legat pe loopback si protectie formula injection la export.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowChangelog(true)}
                >
                  <ScrollText className="h-4 w-4" />
                  Vezi Noutati
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowManual(true)}
                >
                  <BookOpen className="h-4 w-4" />
                  Manual
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {showChangelog && (
        <ChangelogDialog dialogRef={changelogRef} appVersion={APP_VERSION} onClose={closeChangelog} />
      )}
      {showManual && (
        <ManualDialog
          dialogRef={manualRef}
          appVersion={APP_VERSION}
          onClose={closeManual}
          onDownloadPdf={handleDownloadManualPdf}
          isDownloading={isDownloadingManual}
        />
      )}
    </div>
  );
}
