import { useEffect, useState, useCallback } from "react";
import { Database, RefreshCw, Info, FolderOpen, Archive, X, Trash2, History, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  rnpmGetStats,
  rnpmOpenDbFolder,
  rnpmOpenBackupsFolder,
  rnpmCreateBackup,
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
        <Info className="h-4 w-4" /> Baza mea RNPM
      </Button>
      {open && (
        <StatsModal onClose={() => setOpen(false)} refreshKey={refreshKey} onAfterDeleteAll={onAfterDeleteAll} />
      )}
    </>
  );
}

function StatsModal({
  onClose,
  refreshKey,
  onAfterDeleteAll,
}: { onClose: () => void; refreshKey?: number; onAfterDeleteAll?: () => void }) {
  const confirm = useConfirm();
  const [stats, setStats] = useState<RnpmStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactMsg, setCompactMsg] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey este trigger extern intentionat pentru reincarcarea statisticilor.
  useEffect(() => {
    void load();
    void loadBackups();
  }, [load, loadBackups, refreshKey]);

  useEffect(() => {
    // v2.20.8 — Batch 2.5: cat timp VACUUM-ul ruleaza, blocheaza si ESC ca user-ul
    // sa nu inchida modalul si sa creada ca s-a terminat. Splash-ul ramane vizibil.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !compacting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, compacting]);

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

  // v2.43.0 (rnpm-split): backup manual self-service al fisierului propriu.
  // 429 (cooldown) vine ca Error cu mesajul din envelope — il afisam ca
  // eroare temporara, butonul ramane activ.
  const handleCreateBackup = async () => {
    if (creatingBackup) return;
    setCreatingBackup(true);
    setFolderError(null);
    setCompactMsg(null);
    try {
      const { name } = await rnpmCreateBackup();
      setCompactMsg(`Backup creat: ${name}.`);
      await loadBackups();
    } catch (e) {
      setFolderError(e instanceof Error ? e.message : "Eroare la crearea backup-ului");
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDeleteBackups = async () => {
    if (
      !(await confirm({
        message: "Stergi toate backup-urile TALE RNPM?\n\nCelelalte module si ceilalti utilizatori nu sunt afectati.",
        confirmLabel: "Sterge backups",
        destructive: true,
      }))
    )
      return;
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
    if (
      !(await confirm({
        message:
          "Compactezi baza locala? Operatia rescrie fisierul pentru a elibera spatiul lasat liber de stergeri si poate dura cateva secunde.",
        confirmLabel: "Compacteaza",
      }))
    )
      return;
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
    if (
      !(await confirm({
        message: `Stergi TOATE cele ${formatNumber(stats.total)} avize din baza locala?\n\nActiunea nu poate fi anulata.`,
        confirmLabel: "Sterge tot",
        destructive: true,
      }))
    )
      return;
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdropul se inchide via butonul X dedicat sau Escape la nivel de document.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!compacting) onClose();
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe div previne click-through pe backdrop; tastatura via focus trap intern. */}
      <div
        className="flex w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" />
            Baza mea RNPM
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={compacting}
            className="rounded-lg p-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title={compacting ? "Asteapta finalul compactarii" : "Inchide"}
          >
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
            <div className="text-sm text-muted-foreground">{loading ? "Se incarca statistici..." : "—"}</div>
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
                  Dimensiune: <span className="font-mono text-foreground">{formatBytes(stats.db.sizeBytes)}</span>{" "}
                  <span className="opacity-70">(date + jurnal)</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Button type="button" variant="outline" size="sm" onClick={handleOpenFolder}>
                  <FolderOpen className="h-4 w-4" /> Folder baza
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleOpenBackups}>
                  <Archive className="h-4 w-4" /> Backups
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCreateBackup}
                  disabled={creatingBackup}
                  title="Creeaza un backup manual al bazei tale RNPM"
                >
                  {creatingBackup ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                  Creeaza backup acum
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
              {folderError && <div className="text-xs text-red-600 dark:text-red-400">{folderError}</div>}
              {compactMsg && <div className="text-xs text-muted-foreground">{compactMsg}</div>}
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
      {compacting && <CompactSplash />}
    </div>
  );
}

// v2.20.8 — Batch 2.5: splash full-screen pe durata VACUUM. Operatia poate dura
// zeci de secunde pe baze mari (100MB+) si blocheaza event loop-ul backend-ului
// (vezi compactDb in db/schema.ts). Fara splash, butonul cu spinner pe el e prea
// discret — userii inchideau aplicatia crezand ca s-a blocat. Splash-ul:
//  - cover total z-[60] (peste modalul de stats z-50)
//  - mesaj clar "NU INCHIDE APLICATIA"
//  - blocheaza pointer events si scroll
//  - nu primeste onClick handlers (nu se poate inchide accidental)
function CompactSplash() {
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-busy="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4"
    >
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-5 text-center shadow-2xl">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
        <div className="text-sm font-semibold">Compactez baza locala...</div>
        <div className="text-xs text-muted-foreground">
          Operatia rescrie fisierul DB si poate dura cateva zeci de secunde pe baze mari.
          <br />
          <strong className="text-foreground">Nu inchide aplicatia</strong> pana cand acest mesaj dispare.
        </div>
      </div>
    </div>
  );
}
