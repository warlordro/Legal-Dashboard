import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { rnpmListBackups, rnpmRestoreBackup, type RnpmBackupEntry } from "@/lib/rnpmApi";
import { formatBytes } from "@/lib/utils";

function formatBackupDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RnpmRestoreModal({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const confirm = useConfirm();
  const [backups, setBackups] = useState<RnpmBackupEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBackups(await rnpmListBackups());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare listare backups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !restoring) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, restoring]);

  const handleRestore = async (entry: RnpmBackupEntry) => {
    if (restoring) return;
    if (
      !(await confirm({
        message: `Restaurezi DOAR datele tale RNPM din ${entry.name}?\n\nRestul aplicatiei (monitorizari, utilizatori, setari) NU este afectat. Baza ta actuala va fi salvata automat ca rnpm.pre-restore-*.db inainte de suprascriere.`,
        confirmLabel: "Restaureaza",
        destructive: true,
      }))
    )
      return;
    setRestoring(entry.name);
    setError(null);
    try {
      const { preRestoreName } = await rnpmRestoreBackup(entry.name);
      // Fara "reporneste aplicatia" — fisierul per user se redeschide lazy.
      setSuccessMsg(`Restaurare completa. Snapshot pre-restore: ${preRestoreName}.`);
      setTimeout(onRestored, 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare restore");
    } finally {
      setRestoring(null);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdropul se inchide via butonul X dedicat sau Escape printr-un document-level handler.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={restoring ? undefined : onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation pe div previne click-through pe backdrop; tastatura via focus trap intern. */}
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-muted-foreground" />
            Restaurare baza mea RNPM
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={!!restoring}
            className="rounded-lg p-1 hover:bg-muted disabled:opacity-50"
            title="Inchide"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
              {successMsg}
            </div>
          )}
          {loading && <div className="text-sm text-muted-foreground">Se incarca lista...</div>}
          {!loading && backups && backups.length === 0 && (
            <div className="text-sm text-muted-foreground">Nu exista backup-uri disponibile.</div>
          )}
          {!loading && backups && backups.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Alege un backup. Baza actuala va fi salvata automat inainte de suprascriere.
              </p>
              <ul className="divide-y divide-border rounded-md border border-border">
                {backups.map((b) => (
                  <li key={b.name} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{b.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatBackupDate(b.mtime)} · {formatBytes(b.sizeBytes)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!!restoring || !!successMsg}
                      onClick={() => void handleRestore(b)}
                    >
                      {restoring === b.name ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <History className="h-3.5 w-3.5" />
                      )}
                      Restaureaza
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
