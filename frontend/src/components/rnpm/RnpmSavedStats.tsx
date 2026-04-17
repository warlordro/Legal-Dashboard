import { useEffect, useState, useCallback } from "react";
import { Database, Copy, Check, RefreshCw, Info, FolderOpen, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { rnpmGetStats, rnpmOpenDbFolder, rnpmDeleteAllSaved } from "@/lib/rnpmApi";
import type { RnpmStats, RnpmSearchType } from "@/types/rnpm";

const TYPE_LABEL: Record<RnpmSearchType, string> = {
  ipoteci: "Ipoteci",
  fiducii: "Fiducii",
  specifice: "Specifice",
  creante: "Creante",
  obligatiuni: "Obligatiuni",
};

const TYPE_ORDER: RnpmSearchType[] = ["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("ro-RO");
}

export interface RnpmSavedStatsProps {
  refreshKey?: number;
  onAfterDeleteAll?: () => void;
}

export function RnpmSavedStats({ refreshKey, onAfterDeleteAll }: RnpmSavedStatsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Info className="h-4 w-4" /> Info baza locala
      </Button>
      {open && <StatsModal onClose={() => setOpen(false)} refreshKey={refreshKey} onAfterDeleteAll={onAfterDeleteAll} />}
    </>
  );
}

function StatsModal({ onClose, refreshKey, onAfterDeleteAll }: { onClose: () => void; refreshKey?: number; onAfterDeleteAll?: () => void }) {
  const [stats, setStats] = useState<RnpmStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await rnpmGetStats());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare incarcare statistici");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopyPath = async () => {
    if (!stats?.db.path) return;
    try {
      await navigator.clipboard.writeText(stats.db.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Nu am putut copia calea");
    }
  };

  const handleOpenFolder = async () => {
    setFolderError(null);
    try {
      await rnpmOpenDbFolder();
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "Nu am putut deschide folderul");
    }
  };

  const handleDeleteAll = async () => {
    if (!stats || stats.total === 0) return;
    if (!confirm(`Stergi TOATE cele ${formatNumber(stats.total)} avize din baza locala?\n\nActiunea nu poate fi anulata.`)) return;
    setDeleting(true);
    try {
      await rnpmDeleteAllSaved();
      onAfterDeleteAll?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la stergere");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" />
            Info baza locala
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted" title="Inchide">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
              <Button variant="ghost" size="sm" onClick={() => void load()} className="ml-2 h-7">
                <RefreshCw className="h-3.5 w-3.5" /> Reincearca
              </Button>
            </div>
          )}

          {!error && !stats && (
            <div className="text-sm text-muted-foreground">
              {loading ? "Se incarca statistici..." : "—"}
            </div>
          )}

          {stats && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatNumber(stats.total)} avize</span>
                <span className="text-muted-foreground">
                  ({formatNumber(stats.activ)} active / {formatNumber(stats.inactiv)} inactive)
                </span>
              </div>

              {stats.total > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_ORDER.map((t) => {
                    const n = stats.byType[t] ?? 0;
                    if (n === 0) return null;
                    return (
                      <Badge key={t} variant="outline" className="text-[11px]">
                        {TYPE_LABEL[t]}: {formatNumber(n)}
                      </Badge>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  Dimensiune:{" "}
                  <span className="font-mono text-foreground">{formatBytes(stats.db.sizeBytes)}</span>{" "}
                  <span className="opacity-70">(date + jurnal)</span>
                </div>
                <div className="flex items-start gap-1">
                  <span className="pt-0.5">Cale:</span>
                  <span
                    className="font-mono text-foreground break-all flex-1"
                    title={stats.db.path}
                  >
                    {stats.db.path}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyPath}
                    className="h-6 w-6 p-0 flex-shrink-0"
                    title={copied ? "Copiat!" : "Copiaza calea"}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-border pt-3">
                <Button type="button" variant="outline" size="sm" onClick={handleOpenFolder}>
                  <FolderOpen className="h-4 w-4" /> Deschide folder
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteAll}
                  disabled={deleting || stats.total === 0}
                  className="ml-auto text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                >
                  {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Sterge tot
                </Button>
              </div>
              {folderError && (
                <div className="text-xs text-red-600 dark:text-red-400">{folderError}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
