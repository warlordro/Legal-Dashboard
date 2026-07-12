// v2.43.x (admin rnpm storage): cardul "Stocare RNPM" din tab Setari > Backup.
// Dimensiunea bazei RNPM per utilizator (fisiere separate din v2.43.0) plus
// compactarea (VACUUM) cross-owner, admin-only. Datele in ordinea primita de la
// repository (email ASC); UI-ul nu re-sorteaza.

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, HardDriveDownload, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { adminListRnpmUsage, type AdminRnpmUsageRow } from "@/lib/adminRnpmApi";
import { ApiError, rnpmCompactDb, rnpmDeleteBackups } from "@/lib/rnpmApi";
import { userStatusLabel } from "@/lib/userLabels";
import { cn, formatBytes } from "@/lib/utils";

export default function AdminRnpmStorage({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<AdminRnpmUsageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // busy poarta si actiunea, ca spinnerul sa apara pe butonul apasat, nu pe
  // amandoua; cat timp e non-null toate actiunile per rand sunt dezactivate.
  const [busy, setBusy] = useState<{ ownerId: string; action: "compact" | "delete" } | null>(null);
  // Userii stersi/suspendati FARA date (fara baza vie si fara backup-uri) sunt
  // doar zgomot in lista — ascunsi implicit. Cei care inca ocupa spatiu raman
  // mereu vizibili: exact pe ei trebuie sa-i vada adminul ca sa curete.
  const [showInactive, setShowInactive] = useState(false);
  // AbortController + staleness guard (pattern 6.7): un raspuns lent pornit
  // inainte de un reload ar ateriza dupa cel nou si ar suprascrie lista cu
  // starea veche. Reincarca si reload-ul post-compact folosesc acelasi load().
  const acRef = useRef<AbortController | null>(null);
  // Guard-uri sincrone (fix review Codex): mutatiile nu au AbortController,
  // deci un raspuns tarziu ar face setState + reload DUPA unmount; iar dublul
  // click pe Compacteaza/Sterge inainte de confirmare ar deschide un al doilea
  // confirm() care orfaneaza promisiunea primului (state-ul providerului e
  // inlocuit, nu pus in coada). Ref-ul e partajat de ambele actiuni: un singur
  // dialog de confirmare deschis o data.
  const mountedRef = useRef(true);
  const actionInFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const result = await adminListRnpmUsage(ac.signal);
      if (ac.signal.aborted) return;
      setRows(result);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Eroare la incarcarea utilizarii RNPM.");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      acRef.current?.abort();
    };
  }, [load]);

  const handleCompact = async (row: AdminRnpmUsageRow) => {
    // Ref sincron, nu state: doua clickuri in acelasi tick vad amandoua
    // busy === null (setState e asincron), dar ref-ul se inchide imediat.
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      const ok = await confirm({
        title: "Compacteaza baza RNPM",
        message: `Compactezi baza RNPM a userului ${row.email}? Operatia elibereaza spatiul nefolosit si poate dura cateva secunde.`,
        confirmLabel: "Compacteaza",
      });
      if (!ok || !mountedRef.current) return;
      setBusy({ ownerId: row.userId, action: "compact" });
      setError(null);
      setSuccessMsg(null);
      try {
        const result = await rnpmCompactDb(row.userId);
        if (!mountedRef.current) return;
        setSuccessMsg(`Compactat: ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)}.`);
        await load();
      } catch (e) {
        if (!mountedRef.current) return;
        if (e instanceof ApiError && e.status === 409) {
          setError("Userul are o operatie RNPM in curs (cautare sau restaurare); reincearca dupa finalizare.");
        } else {
          setError(e instanceof Error ? e.message : "Eroare la compactarea bazei RNPM.");
        }
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const handleDeleteBackups = async (row: AdminRnpmUsageRow) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    try {
      const ok = await confirm({
        title: "Sterge backup-urile RNPM",
        message: `Stergi toate backup-urile RNPM ale userului ${row.email} (${row.backupCount}, ${formatBytes(row.backupsBytes)})? Operatia nu poate fi anulata.`,
        confirmLabel: "Sterge",
        destructive: true,
      });
      if (!ok || !mountedRef.current) return;
      setBusy({ ownerId: row.userId, action: "delete" });
      setError(null);
      setSuccessMsg(null);
      try {
        const deleted = await rnpmDeleteBackups(row.userId);
        if (!mountedRef.current) return;
        setSuccessMsg(`Backup-uri sterse: ${deleted}.`);
        await load();
      } catch (e) {
        if (!mountedRef.current) return;
        if (e instanceof ApiError && e.status === 409) {
          setError("Userul are o operatie RNPM in curs (cautare sau restaurare); reincearca dupa finalizare.");
        } else {
          setError(e instanceof Error ? e.message : "Eroare la stergerea backup-urilor RNPM.");
        }
      } finally {
        if (mountedRef.current) setBusy(null);
      }
    } finally {
      actionInFlightRef.current = false;
    }
  };

  const hasFootprint = (row: AdminRnpmUsageRow) => row.dbSizeBytes !== null || row.backupCount > 0;
  const visibleRows = rows?.filter((row) => showInactive || row.status === "active" || hasFootprint(row)) ?? null;
  const hiddenCount = rows && visibleRows ? rows.length - visibleRows.length : 0;

  const body = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-muted-foreground" />
          Stocare RNPM
        </CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy !== null}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Reincarca
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Dimensiunea bazei RNPM per utilizator (fisiere separate) si backup-urile lor. Compactarea (VACUUM) elibereaza
          spatiul nefolosit dupa stergeri masive; stergerea backup-urilor elibereaza spatiul ocupat de copiile de
          siguranta ale userului.
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
        {loading && !rows && <div className="text-sm text-muted-foreground">Se incarca lista...</div>}
        {rows && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">Niciun utilizator inregistrat.</div>
        )}
        {(hiddenCount > 0 || showInactive) && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Arata si userii stersi sau suspendati fara date ({hiddenCount})
          </label>
        )}
        {visibleRows && visibleRows.length === 0 && rows && rows.length > 0 && (
          <div className="text-sm text-muted-foreground">
            Toti userii ramasi sunt stersi sau suspendati, fara date RNPM.
          </div>
        )}
        {visibleRows && visibleRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Utilizator</th>
                  <th className="px-3 py-2 font-semibold">Baza (folosit / limita)</th>
                  <th className="px-3 py-2 font-semibold">Backup-uri</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRows.map((row) => (
                  <tr key={row.userId}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono text-xs">{row.email}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {row.displayName && <span className="text-xs text-muted-foreground">{row.displayName}</span>}
                        {row.status !== "active" && <Badge variant="warning">{userStatusLabel(row.status)}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs">
                      <span
                        data-storage-warning={
                          row.dbSizeBytes !== null &&
                          row.storageLimitBytes != null &&
                          row.storageLimitBytes > 0 &&
                          row.dbSizeBytes / row.storageLimitBytes > 0.85
                            ? "true"
                            : undefined
                        }
                        className={cn(
                          row.dbSizeBytes !== null &&
                            row.storageLimitBytes != null &&
                            row.storageLimitBytes > 0 &&
                            row.dbSizeBytes / row.storageLimitBytes > 0.85 &&
                            "font-semibold text-red-600 dark:text-red-400"
                        )}
                      >
                        {row.dbSizeBytes === null ? "—" : formatBytes(row.dbSizeBytes)} /{" "}
                        {row.storageLimitBytes == null ? "Nelimitat" : formatBytes(row.storageLimitBytes)}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {row.backupCount} ({formatBytes(row.backupsBytes)})
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={row.dbSizeBytes === null || busy !== null}
                          onClick={() => void handleCompact(row)}
                        >
                          {busy?.ownerId === row.userId && busy.action === "compact" ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <HardDriveDownload className="h-3.5 w-3.5" />
                          )}
                          Compacteaza
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={row.backupCount === 0 || busy !== null}
                          onClick={() => void handleDeleteBackups(row)}
                          className="text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 disabled:opacity-50"
                        >
                          {busy?.ownerId === row.userId && busy.action === "delete" ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          Sterge backup-urile
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
