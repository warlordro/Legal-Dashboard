import { lazy, Suspense, useCallback, useState } from "react";
import { Scale, FileSearch, CalendarDays, ArrowRight, FolderOpen, BarChart3, ScrollText, X, BookOpen, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/hooks/useDialog";
import type { Dosar } from "@/types";

// Lazy: both modals are only mounted after user clicks "Noutati" / "Manual",
// and the Manual pulls in the PDF export pipeline (jspdf + xlsx).
const Changelog = lazy(() => import("@/pages/Changelog"));
const Manual = lazy(() => import("@/pages/Manual"));

const APP_VERSION = `v${__APP_VERSION__}`;

interface DosareState {
  allDosare: Dosar[];
  categorii: string[];
  stadii: string[];
  searched: boolean;
  error: string | null;
  searchedName?: string;
}

interface DashboardProps {
  dosareState: DosareState;
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

export default function Dashboard({ dosareState }: DashboardProps) {
  const [showChangelog, setShowChangelog] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [isDownloadingManual, setIsDownloadingManual] = useState(false);
  const hasDosareData = dosareState.searched && dosareState.allDosare.length > 0;

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

  const modalFallback = (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Se incarca...
    </div>
  );

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

      {/* Last search summary */}
      {hasDosareData && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ultima Cautare
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FolderOpen className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dosare Gasite</p>
                  <p className="text-lg font-bold">{dosareState.allDosare.length}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Categorii</p>
                  <p className="text-lg font-bold">{getUniqueCategories(dosareState.allDosare).length}</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                  <Scale className="h-4 w-4 text-teal-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Institutii</p>
                  <p className="text-lg font-bold">{getUniqueInstitutii(dosareState.allDosare)}</p>
                </div>
              </div>
            </Card>
            {dosareState.searchedName && (
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                    <FileSearch className="h-4 w-4 text-purple-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Parte Cautata</p>
                    <p className="truncate text-sm font-bold">{dosareState.searchedName}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
          <div className="mt-3">
            <Link
              to="/dosare"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
            >
              Vezi dosarele <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

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

      {/* Changelog Modal */}
      {showChangelog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeChangelog}>
          <div
            ref={changelogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="changelog-title"
            tabIndex={-1}
            className="relative mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-background shadow-2xl focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <ScrollText className="h-5 w-5 text-violet-500" />
                <h2 id="changelog-title" className="text-lg font-bold">Noutati</h2>
                <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 text-xs font-bold">
                  {APP_VERSION}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={closeChangelog} aria-label="Inchide noutati">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Scrollable content */}
            <div className="overflow-y-auto scrollbar-thin px-2 py-4">
              <Suspense fallback={modalFallback}>
                <Changelog />
              </Suspense>
            </div>
          </div>
        </div>
      )}
      {/* Manual Modal */}
      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeManual}>
          <div
            ref={manualRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-title"
            tabIndex={-1}
            className="relative mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-background shadow-2xl focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-primary" />
                <h2 id="manual-title" className="text-lg font-bold">Manual de Utilizare</h2>
                <Badge className="bg-primary/10 text-primary text-xs font-bold">
                  {APP_VERSION}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={closeManual} aria-label="Inchide manual">
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* Scrollable content */}
            <div className="overflow-y-auto scrollbar-thin px-2 py-4">
              <Suspense fallback={modalFallback}>
                <Manual onDownloadPdf={handleDownloadManualPdf} isDownloading={isDownloadingManual} />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
