// v2.43.x (admin rnpm storage): cardul "Stocare RNPM" din tab Setari > Backup.
// Dimensiunea bazei RNPM per utilizator (fisiere separate din v2.43.0) plus
// compactarea (VACUUM) cross-owner, admin-only. Datele in ordinea primita de la
// repository (email ASC); UI-ul nu re-sorteaza.

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, HardDriveDownload, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { adminListRnpmUsage, type AdminRnpmUsageRow } from "@/lib/adminRnpmApi";
import { ApiError, rnpmCompactDb } from "@/lib/rnpmApi";
import { userStatusLabel } from "@/lib/userLabels";
import { cn, formatBytes } from "@/lib/utils";

export default function AdminRnpmStorage({ embedded = false }: { embedded?: boolean } = {}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<AdminRnpmUsageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [busyOwnerId, setBusyOwnerId] = useState<string | null>(null);
  // AbortController + staleness guard (pattern 6.7): un raspuns lent pornit
  // inainte de un reload ar ateriza dupa cel nou si ar suprascrie lista cu
  // starea veche. Reincarca si reload-ul post-compact folosesc acelasi load().
  const acRef = useRef<AbortController | null>(null);
  // Guard-uri sincrone (fix review Codex): compactarea nu are AbortController,
  // deci un raspuns tarziu ar face setState + reload DUPA unmount; iar dublul
  // click pe Compacteaza inainte de confirmare ar deschide un al doilea
  // confirm() care orfaneaza promisiunea primului (state-ul providerului e
  // inlocuit, nu pus in coada).
  const mountedRef = useRef(true);
  const compactInFlightRef = useRef(false);

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
    // busyOwnerId === null (setState e asincron), dar ref-ul se inchide imediat.
    if (compactInFlightRef.current) return;
    compactInFlightRef.current = true;
    try {
      const ok = await confirm({
        title: "Compacteaza baza RNPM",
        message: `Compactezi baza RNPM a userului ${row.email}? Operatia elibereaza spatiul nefolosit si poate dura cateva secunde.`,
        confirmLabel: "Compacteaza",
      });
      if (!ok || !mountedRef.current) return;
      setBusyOwnerId(row.userId);
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
        if (mountedRef.current) setBusyOwnerId(null);
      }
    } finally {
      compactInFlightRef.current = false;
    }
  };

  const body = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-muted-foreground" />
          Stocare RNPM
        </CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busyOwnerId !== null}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Reincarca
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Dimensiunea bazei RNPM per utilizator (fisiere separate) si backup-urile lor. Compactarea (VACUUM) elibereaza
          spatiul nefolosit dupa stergeri masive.
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
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Utilizator</th>
                  <th className="px-3 py-2 font-semibold">Baza</th>
                  <th className="px-3 py-2 font-semibold">Backup-uri</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.userId}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono text-xs">{row.email}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {row.displayName && <span className="text-xs text-muted-foreground">{row.displayName}</span>}
                        {row.status !== "active" && <Badge variant="warning">{userStatusLabel(row.status)}</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs">
                      {row.dbSizeBytes === null ? "—" : formatBytes(row.dbSizeBytes)}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                      {row.backupCount} ({formatBytes(row.backupsBytes)})
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={row.dbSizeBytes === null || busyOwnerId !== null}
                        onClick={() => void handleCompact(row)}
                      >
                        {busyOwnerId === row.userId ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <HardDriveDownload className="h-3.5 w-3.5" />
                        )}
                        Compacteaza
                      </Button>
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
