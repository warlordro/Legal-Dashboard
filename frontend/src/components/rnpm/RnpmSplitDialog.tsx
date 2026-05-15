import { Split, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialog } from "@/hooks/useDialog";
import { TIP_AVIZ_BY_CATEGORY, DESTINATIE_IPOTECI, DESTINATIE_INSCRIERII } from "@/components/rnpm/rnpm-form-constants";
import type { RnpmSearchType } from "@/types/rnpm";
import type { CaptchaProvider } from "@/lib/rnpmApi";

// v2.18.0: categorii cu tier-2 split disponibil pe destinatieInscriere. Mirror al
// backend/src/services/rnpmDestinations.ts (DESTINATII_BY_CATEGORY).
const DESTINATIONS_BY_CATEGORY: Partial<Record<RnpmSearchType, string[]>> = {
  ipoteci: DESTINATIE_IPOTECI,
  specifice: DESTINATIE_INSCRIERII,
};

interface Props {
  open: boolean;
  type: RnpmSearchType;
  total: number | undefined;
  limit: number | undefined;
  captchaProvider: CaptchaProvider;
  onCancel: () => void;
  onConfirm: (subTypeLabels: string[]) => void;
}

const PER_CAPTCHA_USD: Record<CaptchaProvider, number> = {
  "2captcha": 0.003,
  capsolver: 0.0008,
};

const PER_SUBTYPE_SECONDS = 17;

export function RnpmSplitDialog({ open, type, total, limit, captchaProvider, onCancel, onConfirm }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(open, onCancel);
  if (!open) return null;

  const subTypeLabels = TIP_AVIZ_BY_CATEGORY[type];
  const n = subTypeLabels.length;
  const destinationsForType = DESTINATIONS_BY_CATEGORY[type] ?? [];
  const hasTier2 = destinationsForType.length > 0;
  // Tier-2 (best-effort): worst case daca toate sub-tipurile depasesc tot capul,
  // costul este `n * (1 + destinations.length)` captcha-uri. In practica cel mult
  // 1-2 sub-tipuri din N triggered tier-2 (caz empiric specifice CUI 33317138:
  // 1 sub-tip "aviz initial" cu 1823 records). Aratam ESTIMARE realista (1 tier-2)
  // pentru a nu inflata fals costul.
  const tier2Captchas = hasTier2 ? destinationsForType.length : 0;
  const captchasMin = n;
  const captchasMax = n + tier2Captchas;
  const costMinUsd = (captchasMin * PER_CAPTCHA_USD[captchaProvider]).toFixed(3);
  const costMaxUsd = (captchasMax * PER_CAPTCHA_USD[captchaProvider]).toFixed(3);
  const costUsd = hasTier2 ? `${costMinUsd}–${costMaxUsd}` : costMinUsd;
  const etaSec = n * PER_SUBTYPE_SECONDS;
  const etaSecMax = (n + tier2Captchas) * PER_SUBTYPE_SECONDS;
  const fmtEta = (s: number) => (s >= 60 ? `~${Math.ceil(s / 60)} min` : `~${s} s`);
  const etaTxt = hasTier2 ? `${fmtEta(etaSec)} – ${fmtEta(etaSecMax)}` : fmtEta(etaSec);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rnpm-split-dialog-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="rnpm-split-dialog-title" className="flex items-center gap-2 text-lg font-semibold">
            <Split className="h-5 w-5 text-amber-600" />
            Cautare prea larga
          </h3>
          <button onClick={onCancel} aria-label="Inchide" className="rounded-lg p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <p>
            RNPM a returnat <b>{total ?? "?"} rezultate</b>
            {limit ? (
              <>
                {" "}
                (peste limita oficiala de <b>{limit}</b>)
              </>
            ) : null}
            . Pentru a obtine totusi inregistrarile, putem rula <b>{n} cautari separate</b>, cate una pentru fiecare tip
            de inscriere disponibil la categoria curenta.
          </p>

          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sub-tipuri rulate</span>
              <span className="font-medium">{n}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Captcha-uri necesare</span>
              <span className="font-medium">
                {hasTier2 ? (
                  <>
                    {captchasMin}–{captchasMax}
                  </>
                ) : (
                  n
                )}{" "}
                × ~${PER_CAPTCHA_USD[captchaProvider].toFixed(4)} = ${costUsd}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Durata estimata</span>
              <span className="font-medium">{etaTxt}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provider captcha</span>
              <span className="font-medium">{captchaProvider}</span>
            </div>
          </div>

          <p className="text-[12px] text-muted-foreground">
            {hasTier2 ? (
              <>
                Daca un sub-tip individual depaseste tot limita RNPM, incercam o a doua runda de split pe destinatie (
                <b>{destinationsForType.length} valori</b>). Recuperarea este <b>best-effort</b>: inregistrarile fara
                destinatie atribuita pot ramane neacoperite (un gap evidentiat dupa rulare).
              </>
            ) : (
              <>
                Daca un sub-tip individual depaseste tot limita RNPM, este marcat ca <b>respins</b>
                si cautarea continua cu celelalte (fara reincercari recursive). Categoria curenta nu are lista de
                destinatii enumerable -&gt; tier-2 split nu e disponibil.
              </>
            )}{" "}
            Inregistrarile colectate sunt salvate normal in baza locala.
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Anuleaza
          </Button>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => onConfirm(subTypeLabels)}
          >
            Continua cu split ({n} cautari)
          </Button>
        </div>
      </div>
    </div>
  );
}
