// v2.43.0 (rnpm-split): administrarea backup-urilor MONOLITULUI (baza unica:
// utilizatori, monitorizari, audit, setari). Datele RNPM au backup separat per
// utilizator, self-service din zona RNPM ("Baza mea RNPM").

import { useCallback, useEffect, useState } from "react";
import { Archive, DatabaseBackup, History, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  adminCreateBackup,
  adminDeleteBackups,
  adminListBackups,
  adminRestoreBackup,
  type BackupEntry,
} from "@/lib/adminBackupsApi";
import { formatBytes } from "@/lib/utils";

function formatBackupDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminBackups({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "create" | "delete" | <nume backup>

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBackups(await adminListBackups());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare listare backups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (busy) return;
    setBusy("create");
    setError(null);
    setSuccessMsg(null);
    try {
      const { name } = await adminCreateBackup();
      setSuccessMsg(`Backup creat: ${name}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la crearea backup-ului");
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (entry: BackupEntry) => {
    if (busy) return;
    if (
      !(await confirm({
        title: "Restaureaza backup",
        message:
          "Restaurezi backup-ul COMPLET al bazei — toate modulele, toti utilizatorii (datele RNPM au backup separat per utilizator)?\n\nBaza curenta va fi salvata automat inainte de suprascriere. Dupa restore este recomandata repornirea aplicatiei.",
        confirmLabel: "Restaureaza",
        destructive: true,
      }))
    )
      return;
    setBusy(entry.name);
    setError(null);
    setSuccessMsg(null);
    try {
      const { preRestoreName } = await adminRestoreBackup(entry.name);
      setSuccessMsg(`Restaurare completa. Snapshot pre-restore: ${preRestoreName}. Aplicatia se reincarca...`);
      // INT-M12: dupa restaurarea monolitului TOT state-ul clientului e stale
      // (useri, alerte, setari). Reload complet dupa un beat vizibil.
      setTimeout(() => window.location.reload(), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare restore");
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteAll = async () => {
    if (busy) return;
    if (
      !(await confirm({
        message: "Stergi toate backup-urile bazei complete?\n\nBackup-urile RNPM per utilizator nu sunt afectate.",
        confirmLabel: "Sterge toate",
        destructive: true,
      }))
    )
      return;
    setBusy("delete");
    setError(null);
    setSuccessMsg(null);
    try {
      const deleted = await adminDeleteBackups();
      setSuccessMsg(`${deleted} backup-uri sterse.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare la stergere backups");
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <DatabaseBackup className="h-4 w-4 text-muted-foreground" />
          Backup baza completa
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCreate} disabled={!!busy}>
            {busy === "create" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Creeaza backup acum
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDeleteAll}
            disabled={!!busy || !backups || backups.length === 0}
            className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
          >
            {busy === "delete" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Sterge toate backup-urile
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Baza completa contine utilizatorii, monitorizarile, auditul si setarile. Datele RNPM au backup separat per
          utilizator, self-service din zona RNPM.
        </p>
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
            <Button variant="ghost" size="sm" onClick={() => void load()} className="ml-2 h-7">
              <RefreshCw className="h-3.5 w-3.5" /> Reincearca
            </Button>
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
                  disabled={!!busy}
                  onClick={() => void handleRestore(b)}
                >
                  {busy === b.name ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <History className="h-3.5 w-3.5" />
                  )}
                  Restaureaza
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  if (embedded) return <div className="max-w-5xl">{body}</div>;
  return (
    <div className="min-h-full bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-5">{body}</div>
    </div>
  );
}
