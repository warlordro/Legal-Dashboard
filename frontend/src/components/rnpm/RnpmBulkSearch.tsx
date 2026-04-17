import { useState, useEffect } from "react";
import { Play, Square, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { rnpmBulkSearch, type CaptchaProvider, type CaptchaMode } from "@/lib/rnpmApi";
import type { RnpmBulkItem, RnpmBulkProgress, RnpmSearchType } from "@/types/rnpm";

const CATEGORIES: { type: RnpmSearchType; label: string }[] = [
  { type: "ipoteci", label: "Aviz de ipoteca mobiliara" },
  { type: "fiducii", label: "Fiducie" },
  { type: "specifice", label: "Aviz specific" },
  { type: "creante", label: "Aviz de ipoteca - creante securitizate" },
  { type: "obligatiuni", label: "Aviz de ipoteca - obligatiuni ipotecare" },
];

type FieldKey = "debitorPJ.CUI" | "debitorPF.CNP" | "debitorPJ.denumire" | "creditorPJ.CUI" | "creditorPJ.denumire";
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "debitorPJ.CUI", label: "CUI Debitor PJ" },
  { key: "debitorPF.CNP", label: "CNP Debitor PF" },
  { key: "debitorPJ.denumire", label: "Denumire Debitor PJ" },
  { key: "creditorPJ.CUI", label: "CUI Creditor PJ" },
  { key: "creditorPJ.denumire", label: "Denumire Creditor PJ" },
];

export interface RnpmBulkSearchProps {
  captchaKey: string;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  onConfigureKey: () => void;
}

export function RnpmBulkSearch({ captchaKey, captchaProvider, fallback2CaptchaKey, captchaMode, onConfigureKey }: RnpmBulkSearchProps) {
  const [type, setType] = useState<RnpmSearchType>("ipoteci");
  const [field, setField] = useState<FieldKey>("debitorPJ.CUI");
  const [valuesText, setValuesText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RnpmBulkProgress[]>([]);
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);

  const MAX_BATCH = 100;
  const allValues = valuesText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const values = allValues.slice(0, MAX_BATCH);
  const overLimit = allValues.length > MAX_BATCH;

  const buildItems = (): RnpmBulkItem[] => values.map((value) => {
    const item: RnpmBulkItem = { type, params: {}, label: `${field} = ${value}` };
    const p = item.params;
    switch (field) {
      case "debitorPJ.CUI": p.debitorPJ = { CUI: { type: "1", value } }; break;
      case "debitorPF.CNP": p.debitorPF = { CNP: { type: "1", value } }; break;
      case "debitorPJ.denumire": p.debitorPJ = { denumire: value }; break;
      case "creditorPJ.CUI": p.creditorPJ = { CUI: { type: "1", value } }; break;
      case "creditorPJ.denumire": p.creditorPJ = { denumire: value }; break;
    }
    return item;
  });

  const handleStart = async () => {
    if (!captchaKey) { onConfigureKey(); return; }
    if (values.length === 0) return;
    const items = buildItems();
    const ctl = new AbortController();
    setAbortCtl(ctl);
    setRunning(true);
    setProgress([]);
    try {
      await rnpmBulkSearch(items, captchaKey, (p) => {
        setProgress((prev) => {
          const next = [...prev];
          next[p.index] = p;
          return next;
        });
      }, ctl.signal, captchaProvider, fallback2CaptchaKey, captchaMode);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "AbortError") {
        setProgress((prev) => [...prev, { index: -1, total: values.length, label: "Eroare", phase: "error", error: e instanceof Error ? e.message : String(e) }]);
      }
    } finally {
      setRunning(false);
      setAbortCtl(null);
    }
  };

  const handleStop = () => { abortCtl?.abort(); };

  // Abort in-flight bulk if component unmounts (prevents wasted 2Captcha cost on tab switch)
  useEffect(() => () => { abortCtl?.abort(); }, [abortCtl]);

  // Estimare minima: ~25s/item (captcha + prima pagina + detalii pentru ~25 rezultate).
  // Poate creste semnificativ daca un item returneaza multe inregistrari — fiecare 100 de rezultate
  // adauga ~30s (4 pagini search + ~100 docs × detalii cu concurrency 7).
  const estimatedTimeMin = values.length * 25;
  const estimatedCost = (values.length * 0.003).toFixed(3);
  const done = progress.filter((p) => p?.phase === "done").length;
  const errors = progress.filter((p) => p?.phase === "error").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Categorie</label>
          <select value={type} onChange={(e) => setType(e.target.value as RnpmSearchType)} disabled={running}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            {CATEGORIES.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Camp cautare</label>
          <select value={field} onChange={(e) => setField(e.target.value as FieldKey)} disabled={running}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
            {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Valori (una pe linie) — {allValues.length} intrari (max {MAX_BATCH} per batch)
          {overLimit && <span className="ml-2 text-amber-600">· primele {MAX_BATCH} vor fi procesate</span>}
        </label>
        <textarea
          value={valuesText}
          onChange={(e) => setValuesText(e.target.value)}
          disabled={running}
          rows={6}
          placeholder={"14399840\n123456789\n..."}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span>
          Estimare: <strong>min. ~{Math.ceil(estimatedTimeMin / 60)} min</strong> · <strong>~${estimatedCost}</strong>
          <span className="ml-1 text-muted-foreground">(creste cu numarul de rezultate per item)</span>
        </span>
        {running ? (
          <Button onClick={handleStop} variant="outline" size="sm">
            <Square className="h-4 w-4" /> Opreste
          </Button>
        ) : (
          <Button onClick={handleStart} size="sm" disabled={values.length === 0}>
            <Play className="h-4 w-4" /> Porneste bulk ({values.length})
          </Button>
        )}
      </div>

      {progress.length > 0 && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
            <span>Progres: {done + errors} / {values.length}</span>
            <span>
              <span className="text-green-600">{done} OK</span>
              {errors > 0 && <span className="ml-2 text-red-500">{errors} erori</span>}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-border">
            {progress.filter(Boolean).map((p, i) => (
              <li key={i} className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-xs",
                p.phase === "error" && "text-red-500",
                p.phase === "done" && "text-green-700 dark:text-green-400"
              )}>
                {p.phase === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
                {p.phase === "error" && <XCircle className="h-3.5 w-3.5" />}
                {(p.phase === "captcha" || p.phase === "search" || p.phase === "details") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span className="flex-1 truncate">{p.label}</span>
                <span className="text-muted-foreground">
                  {p.phase === "captcha" && "captcha..."}
                  {p.phase === "search" && "cauta..."}
                  {p.phase === "details" && "detalii..."}
                  {p.phase === "done" && `${p.resultCount} rez.`}
                  {p.phase === "error" && p.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
