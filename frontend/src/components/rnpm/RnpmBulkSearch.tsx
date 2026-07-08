import { useState, useEffect } from "react";
import { Play, Square, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { rnpmBulkSearch, type CaptchaProvider, type CaptchaMode } from "@/lib/rnpmApi";
import type { RnpmBulkItem, RnpmBulkProgress, RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";

const CATEGORIES: { type: RnpmSearchType; label: string }[] = [
  { type: "ipoteci", label: "Aviz de ipoteca mobiliara" },
  { type: "fiducii", label: "Fiducie" },
  { type: "specifice", label: "Aviz specific" },
  { type: "creante", label: "Aviz de ipoteca - creante securitizate" },
  { type: "obligatiuni", label: "Aviz de ipoteca - obligatiuni ipotecare" },
];

// RNPM foloseste chei diferite pentru parti in functie de categorie:
// ipoteci: debitorPJ/debitorPF/creditorPJ; specifice: parteJ/parteF; creante: debitorJ/debitorF/reprezentantCreditor;
// fiducii: constituitorPJ/constituitorPF/fiduciar/beneficiarPJ/beneficiarPF; obligatiuni: agentPJ/agentPF/emitent.
// Trimiterea unui `debitorPJ.CUI` catre /api/search/specifice = 0 rezultate (RNPM nu recunoaste cheia).
type FieldSpec = {
  key: string;
  label: string;
  build: (params: RnpmSearchParams, value: string) => void;
};
const FIELDS_BY_CATEGORY: Record<RnpmSearchType, FieldSpec[]> = {
  ipoteci: [
    {
      key: "debitorPJ.CUI",
      label: "CUI Debitor PJ",
      build: (p, v) => {
        p.debitorPJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "debitorPF.CNP",
      label: "CNP Debitor PF",
      build: (p, v) => {
        p.debitorPF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "debitorPJ.denumire",
      label: "Denumire Debitor PJ",
      build: (p, v) => {
        p.debitorPJ = { denumire: v };
      },
    },
    {
      key: "creditorPJ.CUI",
      label: "CUI Creditor PJ",
      build: (p, v) => {
        p.creditorPJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "creditorPJ.denumire",
      label: "Denumire Creditor PJ",
      build: (p, v) => {
        p.creditorPJ = { denumire: v };
      },
    },
  ],
  specifice: [
    {
      key: "parteJ.CUI",
      label: "CUI Parte PJ",
      build: (p, v) => {
        p.parteJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "parteF.CNP",
      label: "CNP Parte PF",
      build: (p, v) => {
        p.parteF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "parteJ.denumire",
      label: "Denumire Parte PJ",
      build: (p, v) => {
        p.parteJ = { denumire: v };
      },
    },
  ],
  fiducii: [
    {
      key: "constituitorPJ.CUI",
      label: "CUI Constituitor PJ",
      build: (p, v) => {
        p.constituitorPJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "constituitorPF.CNP",
      label: "CNP Constituitor PF",
      build: (p, v) => {
        p.constituitorPF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "constituitorPJ.denumire",
      label: "Denumire Constituitor PJ",
      build: (p, v) => {
        p.constituitorPJ = { denumire: v };
      },
    },
    {
      key: "fiduciar.CUI",
      label: "CUI Fiduciar",
      build: (p, v) => {
        p.fiduciar = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "fiduciar.denumire",
      label: "Denumire Fiduciar",
      build: (p, v) => {
        p.fiduciar = { denumire: v };
      },
    },
    {
      key: "beneficiarPJ.CUI",
      label: "CUI Beneficiar PJ",
      build: (p, v) => {
        p.beneficiarPJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "beneficiarPF.CNP",
      label: "CNP Beneficiar PF",
      build: (p, v) => {
        p.beneficiarPF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "beneficiarPJ.denumire",
      label: "Denumire Beneficiar PJ",
      build: (p, v) => {
        p.beneficiarPJ = { denumire: v };
      },
    },
  ],
  creante: [
    {
      key: "debitorJ.CUI",
      label: "CUI Debitor PJ",
      build: (p, v) => {
        p.debitorJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "debitorF.CNP",
      label: "CNP Debitor PF",
      build: (p, v) => {
        p.debitorF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "debitorJ.denumire",
      label: "Denumire Debitor PJ",
      build: (p, v) => {
        p.debitorJ = { denumire: v };
      },
    },
    {
      key: "reprezentantCreditor.CUI",
      label: "CUI Reprezentant Creditor",
      build: (p, v) => {
        p.reprezentantCreditor = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "reprezentantCreditor.denumire",
      label: "Denumire Reprezentant Creditor",
      build: (p, v) => {
        p.reprezentantCreditor = { denumire: v };
      },
    },
  ],
  obligatiuni: [
    {
      key: "agentPJ.CUI",
      label: "CUI Agent PJ",
      build: (p, v) => {
        p.agentPJ = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "agentPF.CNP",
      label: "CNP Agent PF",
      build: (p, v) => {
        p.agentPF = { CNP: { type: "1", value: v } };
      },
    },
    {
      key: "agentPJ.denumire",
      label: "Denumire Agent PJ",
      build: (p, v) => {
        p.agentPJ = { denumire: v };
      },
    },
    {
      key: "emitent.CUI",
      label: "CUI Emitent",
      build: (p, v) => {
        p.emitent = { CUI: { type: "1", value: v } };
      },
    },
    {
      key: "emitent.denumire",
      label: "Denumire Emitent",
      build: (p, v) => {
        p.emitent = { denumire: v };
      },
    },
  ],
};

export interface RnpmBulkSearchProps {
  captchaKey: string;
  // Blocaj de captcha calculat de parinte (respecta tenant keys in web mode);
  // in desktop = !captchaKey. Sursa unica de politica pentru toata pagina RNPM.
  captchaBlocked: boolean;
  captchaProvider?: CaptchaProvider;
  fallback2CaptchaKey?: string;
  captchaMode?: CaptchaMode;
  onConfigureKey: () => void;
  onItemSaved?: () => void;
}

export function RnpmBulkSearch({
  captchaKey,
  captchaBlocked,
  captchaProvider,
  fallback2CaptchaKey,
  captchaMode,
  onConfigureKey,
  onItemSaved,
}: RnpmBulkSearchProps) {
  const [type, setType] = useState<RnpmSearchType>("ipoteci");
  const [field, setField] = useState<string>(FIELDS_BY_CATEGORY.ipoteci[0].key);
  const [valuesText, setValuesText] = useState("");
  const [activ, setActiv] = useState<boolean>(true);
  const [nemodificat, setNemodificat] = useState<boolean>(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RnpmBulkProgress[]>([]);
  const [abortCtl, setAbortCtl] = useState<AbortController | null>(null);

  const fieldsForType = FIELDS_BY_CATEGORY[type];
  const activeField = fieldsForType.find((f) => f.key === field) ?? fieldsForType[0];

  // v2.20.4: bump 100 -> 200 ca sa egaleze cap-ul server (rnpm.ts:231).
  // Pentru batch-uri >150 CUI recomandam splitting in 2-3 taburi paralele
  // — vezi hint UI mai jos. Cap server ramane 200 ca fail-safe.
  const MAX_BATCH = 200;
  const allValues = valuesText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const values = allValues.slice(0, MAX_BATCH);
  const overLimit = allValues.length > MAX_BATCH;

  const buildItems = (): RnpmBulkItem[] =>
    values.map((value) => {
      const item: RnpmBulkItem = { type, params: {}, label: `${activeField.key} = ${value}` };
      activeField.build(item.params, value);
      // RNPM /api/search trateaza activ:false identic cu activ:true (ambele filtreaza la active-only).
      // Doar absenta cheii aduce active + inactive. De-aceea includem in params NUMAI daca e true.
      if (activ) item.params.activ = true;
      if (nemodificat) item.params.nemodificat = true;
      return item;
    });

  const handleTypeChange = (nextType: RnpmSearchType) => {
    setType(nextType);
    setField(FIELDS_BY_CATEGORY[nextType][0].key);
  };

  const handleStart = async () => {
    if (captchaBlocked) {
      onConfigureKey();
      return;
    }
    if (values.length === 0) return;
    const items = buildItems();
    const ctl = new AbortController();
    setAbortCtl(ctl);
    setRunning(true);
    setProgress([]);
    try {
      await rnpmBulkSearch(
        items,
        captchaKey,
        (p) => {
          setProgress((prev) => {
            const next = [...prev];
            next[p.index] = p;
            return next;
          });
          // Un item persistat → avizele sunt deja scrise in SQLite. Notificam parintele
          // sa refaca fetch-ul in "Baza locala" ca totalul sa urmeze progresul live.
          if (p.phase === "done" && (p.resultCount ?? 0) > 0) onItemSaved?.();
        },
        ctl.signal,
        captchaProvider,
        fallback2CaptchaKey,
        captchaMode
      );
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "AbortError") {
        setProgress((prev) => [
          ...prev,
          {
            index: -1,
            total: values.length,
            label: "Eroare",
            phase: "error",
            error: e instanceof Error ? e.message : String(e),
          },
        ]);
      }
    } finally {
      setRunning(false);
      setAbortCtl(null);
    }
  };

  const handleStop = () => {
    abortCtl?.abort();
  };

  // Abort in-flight bulk if component unmounts (prevents wasted 2Captcha cost on tab switch)
  useEffect(
    () => () => {
      abortCtl?.abort();
    },
    [abortCtl]
  );

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
          <label htmlFor="bulk-categorie" className="mb-1 block text-xs font-medium text-muted-foreground">
            Categorie
          </label>
          <Select value={type} onValueChange={(v) => handleTypeChange(v as RnpmSearchType)}>
            <SelectTrigger id="bulk-categorie" disabled={running}>
              <SelectValue placeholder="Categorie" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.type} value={c.type}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="bulk-camp" className="mb-1 block text-xs font-medium text-muted-foreground">
            Camp cautare
          </label>
          <Select value={activeField.key} onValueChange={setField}>
            <SelectTrigger id="bulk-camp" disabled={running}>
              <SelectValue placeholder="Camp cautare" />
            </SelectTrigger>
            <SelectContent>
              {fieldsForType.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label htmlFor="bulk-valori" className="mb-1 block text-xs font-medium text-muted-foreground">
          Valori (una pe linie) — {allValues.length} intrari (max {MAX_BATCH} per batch)
          {overLimit && <span className="ml-2 text-amber-600">· primele {MAX_BATCH} vor fi procesate</span>}
        </label>
        <textarea
          id="bulk-valori"
          value={valuesText}
          onChange={(e) => setValuesText(e.target.value)}
          disabled={running}
          rows={6}
          placeholder={"14399840\n123456789\n..."}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        {values.length > 150 && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            · Pentru &gt;150 CUI recomandam splitting in 2-3 taburi paralele (fiecare cu ~100 CUI). Fiecare bulk are
            propriul stream SSE si nu se influenteaza reciproc — wall time scade liniar cu numarul de taburi.
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-blue-600"
            checked={activ}
            onChange={(e) => setActiv(e.target.checked)}
            disabled={running}
          />
          Numai active
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-blue-600"
            checked={nemodificat}
            onChange={(e) => setNemodificat(e.target.checked)}
            disabled={running}
          />
          Nemodificate de alte inscrieri
        </label>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span>
          Estimare: <strong>min. ~{Math.ceil(estimatedTimeMin / 60)} min</strong> · <strong>~${estimatedCost}</strong>
          <span className="ml-1 text-muted-foreground">(creste cu numarul de rezultate per item)</span>
        </span>
        {running ? (
          <Button onClick={handleStop} variant="destructive" size="sm">
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
            <span>
              Progres: {done + errors} / {values.length}
            </span>
            <span>
              <span className="text-green-600">{done} OK</span>
              {errors > 0 && <span className="ml-2 text-red-500">{errors} erori</span>}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-border">
            {progress.filter(Boolean).map((p) => (
              <li
                key={`${p.index}-${p.label}`}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs",
                  p.phase === "error" && "text-red-500",
                  p.phase === "done" && "text-green-700 dark:text-green-400"
                )}
              >
                {p.phase === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
                {p.phase === "error" && <XCircle className="h-3.5 w-3.5" />}
                {(p.phase === "captcha" || p.phase === "search" || p.phase === "details") && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
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
