import { useEffect, useState, useCallback } from "react";
import { Database, Copy, Check, RefreshCw, Info, FolderOpen, Archive, X, Trash2, History, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  rnpmGetStats,
  rnpmOpenDbFolder,
  rnpmOpenBackupsFolder,
  rnpmDeleteBackups,
  rnpmDeleteAllSaved,
  rnpmListBackups,
  rnpmCompactDb,
} from "@/lib/rnpmApi";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatBytes, formatRoNumber as formatNumber } from "@/lib/utils";
import { RnpmRestoreModal } from "./RnpmRestoreModal";
import type { RnpmStats, RnpmSearchType } from "@/types/rnpm";

const TYPE_LABEL: Record<RnpmSearchType, string> = {
  ipoteci: "Ipoteci",
  fiducii: "Fiducii",
  specifice: "Specifice",
  creante: "Creante",
  obligatiuni: "Obligatiuni",
};

const TYPE_ORDER: RnpmSearchType[] = ["ipoteci", "fiducii", "specifice", "creante", "obligatiuni"];

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
  const confirm = useConfirm();
  const [stats, setStats] = useState<RnpmStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactMsg, setCompactMsg] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  // null = inca nu am aflat / eroare la listare → lasam butonul activ ca user-ul sa reincerce.
  const [backupCount, setBackupCount] = useState<number | null>(null);

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

  const loadBackups = useCallback(async () => {
    try {
      const list = await rnpmListBackups();
      setBackupCount(list.length);
    } catch {
      setBackupCount(null);
    }
  }, []);

  useEffect(() => { void load(); void loadBackups(); }, [load, loadBackups, refreshKey]);

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

  const handleOpenBackups = async () => {
    setFolderError(null);
    try {
      await rnpmOpenBackupsFolder();
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "Nu am putut deschide folderul backups");
    }
  };

  const handleDeleteBackups = async () => {
    if (!(await confirm({
      message: "Stergi toate backup-urile bazei locale?\n\nUrmatorul backup se va genera la urmatoarea pornire a aplicatiei.",
      confirmLabel: "Sterge backups",
      destructive: true,
    }))) return;
    setFolderError(null);
    try {
      await rnpmDeleteBackups();
      await loadBackups();
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "Eroare la stergere backups");
    }
  };

  const handleCompact = async () => {
    if (compacting) return;
    if (!(await confirm({
      message: "Compactezi baza locala? Operatia rescrie fisierul pentru a elibera spatiul lasat liber de stergeri si poate dura cateva secunde.",
      confirmLabel: "Compacteaza",
    }))) return;
    setCompacting(true);
    setCompactMsg(null);
    setFolderError(null);
    try {
      const { beforeBytes, afterBytes, durationMs } = await rnpmCompactDb();
      const saved = Math.max(0, beforeBytes - afterBytes);
      setCompactMsg(
        saved > 0
          ? `Recuperat ${formatBytes(saved)} in ${(durationMs / 1000).toFixed(1)}s.`
          : `Baza era deja compacta (${(durationMs / 1000).toFixed(1)}s).`
      );
      await load();
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "Eroare la compactare");
    } finally {
      setCompacting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!stats || stats.total === 0) return;
    if (!(await confirm({
      message: `Stergi TOATE cele ${formatNumber(stats.total)} avize din baza locala?\n\nActiunea nu poate fi anulata.`,
      confirmLabel: "Sterge tot",
      destructive: true,
    }))) return;
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
                <div className="leading-5">
                  <span>Cale: </span>
                  <span
                    className="font-mono text-foreground break-all"
                    title={stats.db.path}
                  >
                    {stats.db.path}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPath}
                    className="ml-1 inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={copied ? "Copiat!" : "Copiaza calea"}
                    aria-label={copied ? "Copiat" : "Copiaza calea"}
                  >
                    {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button type="button" variant="outline" size="sm" onClick={handleOpenFolder}>
                  <FolderOpen className="h-4 w-4" /> Folder baza
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleOpenBackups}>
                  <Archive className="h-4 w-4" /> Backups
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowRestore(true)}>
                  <History className="h-4 w-4" /> Restaurare
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCompact}
                  disabled={compacting}
                  title="Rescrie fisierul DB pentru a elibera spatiul marcat liber de stergeri"
                >
                  {compacting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Minimize2 className="h-4 w-4" />}
                  Compacteaza
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteBackups}
                  disabled={backupCount === 0}
                  title={backupCount === 0 ? "Nu exista backup-uri de sters" : undefined}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Sterge back-up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteAll}
                  disabled={deleting || stats.total === 0}
                  className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
                >
                  {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Sterge baza
                </Button>
              </div>
              {folderError && (
                <div className="text-xs text-red-600 dark:text-red-400">{folderError}</div>
              )}
              {compactMsg && (
                <div className="text-xs text-muted-foreground">{compactMsg}</div>
              )}
            </>
          )}
        </div>
      </div>
      {showRestore && (
        <RnpmRestoreModal
          onClose={() => setShowRestore(false)}
          onRestored={() => {
            setShowRestore(false);
            onAfterDeleteAll?.();
            void load();
          }}
        />
      )}
    </div>
  );
}
