import { useEffect, useState } from "react";
import { Search, Loader2, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { RnpmSearchParams, RnpmSearchType } from "@/types/rnpm";
import {
  BUN_ALT_TIP_CATEGORII,
  DESTINATIE_IPOTECI,
  DESTINATIE_INSCRIERII,
  TIP_AVIZ_BY_CATEGORY,
  TIP_LABEL_BY_CATEGORY,
  CATEGORIES,
} from "./rnpm-form-constants";
import { useText, useSiSauField, usePJField, usePFField } from "./rnpm-form-hooks";
import {
  CollapsibleFieldset,
  SiSauInput,
  SiSauToggle,
  PJBlock,
  PartyFieldset,
  VehiculFieldset,
  DestinatieSelect,
} from "./rnpm-form-fields";

// Walk the built params object for any `CUI` field with a non-digit value.
// Returns the first offending value (for the warning message) or null if clean.
// We run this on the post-build params so only the active category's CUI is checked.
function findNonNumericCui(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "CUI" && v && typeof v === "object") {
      const val = (v as { value?: unknown }).value;
      if (typeof val === "string" && /\D/.test(val)) return val;
    } else {
      const nested = findNonNumericCui(v);
      if (nested) return nested;
    }
  }
  return null;
}

export interface RnpmSearchFormProps {
  loading: boolean;
  loadingPhase?: string;
  onSubmit: (type: RnpmSearchType, params: RnpmSearchParams) => void;
  onTypeChange?: (type: RnpmSearchType) => void;
  onStop?: () => void;
  onReset?: () => void;
  initialType?: RnpmSearchType;
  initialParams?: RnpmSearchParams;
  extraActions?: React.ReactNode;
  suppressStop?: boolean;
}

export function RnpmSearchForm({
  loading,
  loadingPhase,
  onSubmit,
  onTypeChange,
  onStop,
  onReset,
  initialType,
  initialParams,
  extraActions,
  suppressStop,
}: RnpmSearchFormProps) {
  const confirm = useConfirm();
  const [activeType, setActiveType] = useState<RnpmSearchType>(initialType ?? "ipoteci");
  const identificator = useText(initialParams?.identificatorInscriere);
  const [perioadaStart, setPerioadaStart] = useState(initialParams?.perioadaStart ?? "");
  const [perioadaFinal, setPerioadaFinal] = useState(initialParams?.perioadaFinal ?? "");
  const [activ, setActiv] = useState<boolean | undefined>(initialParams?.activ ?? true);
  const [nemodificat, setNemodificat] = useState<boolean | undefined>(initialParams?.nemodificat ?? true);
  const tipInscriere = useSiSauField(initialParams?.tipInscriere);
  const destinatie = useSiSauField(initialParams?.destinatieInscriere);

  // Ipoteci
  const [debTip, setDebTip] = useState<"PJ" | "PF">(initialParams?.debitorPF ? "PF" : "PJ");
  const debPJ = usePJField(initialParams?.debitorPJ);
  const debPF = usePFField(initialParams?.debitorPF);
  const [credTip, setCredTip] = useState<"PJ" | "PF">(initialParams?.CreditorPF ? "PF" : "PJ");
  const credPJ = usePJField(initialParams?.creditorPJ);
  const credPF = usePFField(initialParams?.CreditorPF);

  // Fiducii
  const [constTip, setConstTip] = useState<"PJ" | "PF">(initialParams?.constituitorPF ? "PF" : "PJ");
  const constPJ = usePJField(initialParams?.constituitorPJ);
  const constPF = usePFField(initialParams?.constituitorPF);
  const fiduc = usePJField(initialParams?.fiduciar);
  const [benTip, setBenTip] = useState<"PJ" | "PF">(initialParams?.beneficiarPF ? "PF" : "PJ");
  const benPJ = usePJField(initialParams?.beneficiarPJ);
  const benPF = usePFField(initialParams?.beneficiarPF);

  // Specifice
  const [parteTip, setParteTip] = useState<"PJ" | "PF">(initialParams?.parteF ? "PF" : "PJ");
  const parteJ = usePJField(initialParams?.parteJ);
  const parteF = usePFField(initialParams?.parteF);
  const bunADescriere = useText(initialParams?.bunA?.descriere);

  // Creante
  const creanteCred = usePJField(initialParams?.reprezentantCreditor);
  const [creanteDebTip, setCreanteDebTip] = useState<"PJ" | "PF">(initialParams?.debitorF ? "PF" : "PJ");
  const creanteDebJ = usePJField(initialParams?.debitorJ);
  const creanteDebF = usePFField(initialParams?.debitorF);
  const creanteBunDescr = useText(initialParams?.creante?.descriere);

  // Obligatiuni ipotecare
  const [oblAgentTip, setOblAgentTip] = useState<"PJ" | "PF">(initialParams?.agentPF ? "PF" : "PJ");
  const oblAgentJ = usePJField(initialParams?.agentPJ);
  const oblAgentF = usePFField(initialParams?.agentPF);
  const oblEmitent = usePJField(initialParams?.emitent);
  const oblBunDescr = useText(initialParams?.bunGarantie?.descriere);

  // Ipoteci Bun "Alt tip" + Tert cedat (sub-tab-uri in tabul Bun de pe site)
  const bunACategorie = useText(initialParams?.bunA?.categorie);
  const bunAIdentificare = useSiSauField(initialParams?.bunA?.identificare);
  const [tertTip, setTertTip] = useState<"PJ" | "PF">(initialParams?.tertPF ? "PF" : "PJ");
  const tertJ = usePJField(initialParams?.tertPJ);
  const tertF = usePFField(initialParams?.tertPF);

  // Vehicul (shared ipoteci + fiducii)
  const bunVModel = useText(initialParams?.bunV?.model);
  const bunVSasiu = useSiSauField(initialParams?.bunV?.serieSasiu);
  const bunVImatr = useSiSauField(initialParams?.bunV?.nrImatriculare);

  useEffect(() => {
    onTypeChange?.(activeType);
  }, [activeType, onTypeChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const params: RnpmSearchParams = {};

    const idTrim = identificator.trimmed();
    if (idTrim) params.identificatorInscriere = idTrim;
    if (perioadaStart) params.perioadaStart = perioadaStart;
    if (perioadaFinal) params.perioadaFinal = perioadaFinal;
    if (activ != null) params.activ = activ;
    if (nemodificat != null) params.nemodificat = nemodificat;
    const tipInsc = tipInscriere.toParam();
    if (tipInsc) {
      // RNPM asteapta tipInscriere.value ca index 1-based in lista TIP_AVIZ_BY_CATEGORY
      // a tipului curent (confirmat prin Network capture pe /api/search/specifice).
      // Labelul "stingere" era echoat ca '' de RNPM -> 0 rezultate.
      const list = TIP_AVIZ_BY_CATEGORY[activeType];
      const idx = list.indexOf(tipInsc.value);
      params.tipInscriere = {
        type: tipInsc.type,
        value: idx >= 0 ? String(idx + 1) : tipInsc.value,
      };
    }

    if (activeType === "specifice") {
      const dest = destinatie.toParam();
      if (dest) params.destinatieInscriere = dest;
      if (parteTip === "PJ") {
        const den = parteJ.denumire.trimmed();
        const cui = parteJ.cui.toParam();
        if (den || cui) {
          params.parteJ = {};
          if (den) params.parteJ.denumire = den;
          if (cui) params.parteJ.CUI = cui;
        }
      } else {
        // Specifice PF: declanseaza pe nume SAU CNP (prenume singur nu este suficient — parity cu original)
        const nume = parteF.nume.trimmed();
        const pren = parteF.prenume.toParam();
        const cnp = parteF.cnp.toParam();
        if (nume || cnp) {
          params.parteF = {};
          if (nume) params.parteF.nume = nume;
          if (pren) params.parteF.prenume = pren;
          if (cnp) params.parteF.CNP = cnp;
        }
      }
      const bunDesc = bunADescriere.trimmed();
      if (bunDesc) params.bunA = { descriere: bunDesc };
    } else if (activeType === "fiducii") {
      {
        const den = constPJ.denumire.trimmed();
        const cui = constPJ.cui.toParam();
        if (den || cui) {
          params.constituitorPJ = {};
          if (den) params.constituitorPJ.denumire = den;
          if (cui) params.constituitorPJ.CUI = cui;
        }
      }
      {
        const nume = constPF.nume.trimmed();
        const cnp = constPF.cnp.toParam();
        if (nume || cnp) {
          params.constituitorPF = {};
          if (nume) params.constituitorPF.nume = nume;
          if (cnp) params.constituitorPF.CNP = cnp;
        }
      }
      {
        const den = fiduc.denumire.trimmed();
        const cui = fiduc.cui.toParam();
        if (den || cui) {
          params.fiduciar = {};
          if (den) params.fiduciar.denumire = den;
          if (cui) params.fiduciar.CUI = cui;
        }
      }
      {
        const den = benPJ.denumire.trimmed();
        const cui = benPJ.cui.toParam();
        if (den || cui) {
          params.beneficiarPJ = {};
          if (den) params.beneficiarPJ.denumire = den;
          if (cui) params.beneficiarPJ.CUI = cui;
        }
      }
      {
        const nume = benPF.nume.trimmed();
        const cnp = benPF.cnp.toParam();
        if (nume || cnp) {
          params.beneficiarPF = {};
          if (nume) params.beneficiarPF.nume = nume;
          if (cnp) params.beneficiarPF.CNP = cnp;
        }
      }
    } else if (activeType === "creante") {
      {
        const den = creanteCred.denumire.trimmed();
        const reg = creanteCred.reg.toParam();
        const cui = creanteCred.cui.toParam();
        if (den || reg || cui) {
          params.reprezentantCreditor = {};
          if (den) params.reprezentantCreditor.denumire = den;
          if (reg) params.reprezentantCreditor.regCom = reg;
          if (cui) params.reprezentantCreditor.CUI = cui;
        }
      }
      if (creanteDebTip === "PJ") {
        const den = creanteDebJ.denumire.trimmed();
        const reg = creanteDebJ.reg.toParam();
        const cui = creanteDebJ.cui.toParam();
        if (den || reg || cui) {
          params.debitorJ = {};
          if (den) params.debitorJ.denumire = den;
          if (reg) params.debitorJ.RegCom = reg;
          if (cui) params.debitorJ.CUI = cui;
        }
      } else {
        // Creante PF: declanseaza pe nume SAU prenume SAU CNP (parity cu original)
        const nume = creanteDebF.nume.trimmed();
        const pren = creanteDebF.prenume.toParam();
        const cnp = creanteDebF.cnp.toParam();
        if (nume || pren || cnp) {
          params.debitorF = {};
          if (nume) params.debitorF.nume = nume;
          if (pren) params.debitorF.prenume = pren;
          if (cnp) params.debitorF.CNP = cnp;
        }
      }
      const bunDesc = creanteBunDescr.trimmed();
      if (bunDesc) params.creante = { descriere: bunDesc };
    } else if (activeType === "obligatiuni") {
      if (oblAgentTip === "PJ") {
        const den = oblAgentJ.denumire.trimmed();
        const reg = oblAgentJ.reg.toParam();
        const cui = oblAgentJ.cui.toParam();
        if (den || reg || cui) {
          params.agentPJ = {};
          if (den) params.agentPJ.denumire = den;
          if (reg) params.agentPJ.RegCom = reg;
          if (cui) params.agentPJ.CUI = cui;
        }
      } else {
        const nume = oblAgentF.nume.trimmed();
        const pren = oblAgentF.prenume.toParam();
        const cnp = oblAgentF.cnp.toParam();
        if (nume || pren || cnp) {
          params.agentPF = {};
          if (nume) params.agentPF.nume = nume;
          if (pren) params.agentPF.prenume = pren;
          if (cnp) params.agentPF.CNP = cnp;
        }
      }
      {
        const den = oblEmitent.denumire.trimmed();
        const reg = oblEmitent.reg.toParam();
        const cui = oblEmitent.cui.toParam();
        if (den || reg || cui) {
          params.emitent = {};
          if (den) params.emitent.denumire = den;
          if (reg) params.emitent.RegCom = reg;
          if (cui) params.emitent.CUI = cui;
        }
      }
      const bunDesc = oblBunDescr.trimmed();
      if (bunDesc) params.bunGarantie = { descriere: bunDesc };
    } else {
      // ipoteci
      if (activeType === "ipoteci") {
        const dest = destinatie.toParam();
        if (dest) params.destinatieInscriere = dest;
      }
      if (debTip === "PJ") {
        const den = debPJ.denumire.trimmed();
        const cui = debPJ.cui.toParam();
        if (den || cui) {
          params.debitorPJ = {};
          if (den) params.debitorPJ.denumire = den;
          if (cui) params.debitorPJ.CUI = cui;
        }
      } else {
        // Ipoteci PF: declanseaza pe nume SAU CNP (parity cu original)
        const nume = debPF.nume.trimmed();
        const pren = debPF.prenume.toParam();
        const cnp = debPF.cnp.toParam();
        if (nume || cnp) {
          params.debitorPF = {};
          if (nume) params.debitorPF.nume = nume;
          if (pren) params.debitorPF.prenume = pren;
          if (cnp) params.debitorPF.CNP = cnp;
        }
      }
      if (credTip === "PJ") {
        const den = credPJ.denumire.trimmed();
        const cui = credPJ.cui.toParam();
        if (den || cui) {
          params.creditorPJ = {};
          if (den) params.creditorPJ.denumire = den;
          if (cui) params.creditorPJ.CUI = cui;
        }
      } else {
        // CreditorPF: Nume + Prenume + CNP (paritate cu formularul RNPM).
        const nume = credPF.nume.trimmed();
        const pren = credPF.prenume.toParam();
        const cnp = credPF.cnp.toParam();
        if (nume || cnp) {
          params.CreditorPF = {};
          if (nume) params.CreditorPF.nume = nume;
          if (pren) params.CreditorPF.prenume = pren;
          if (cnp) params.CreditorPF.CNP = cnp;
        }
      }
      if (activeType === "ipoteci") {
        // Bun "Alt tip" — Categorie (index string 1..11) + Identificare (SiSau).
        const categorie = bunACategorie.trimmed();
        const identif = bunAIdentificare.toParam();
        if (categorie || identif) {
          params.bunA = {};
          if (categorie) params.bunA.categorie = categorie;
          if (identif) params.bunA.identificare = identif;
        }
        // Tert cedat (sub-tab al "Alt tip"): PJ sau PF in functie de toggle.
        if (tertTip === "PJ") {
          const den = tertJ.denumire.trimmed();
          const reg = tertJ.reg.toParam();
          const cui = tertJ.cui.toParam();
          if (den || reg || cui) {
            params.tertPJ = {};
            if (den) params.tertPJ.denumire = den;
            if (reg) params.tertPJ.RegCom = reg;
            if (cui) params.tertPJ.CUI = cui;
          }
        } else {
          const nume = tertF.nume.trimmed();
          const pren = tertF.prenume.toParam();
          const cnp = tertF.cnp.toParam();
          if (nume || pren || cnp) {
            params.tertPF = {};
            if (nume) params.tertPF.nume = nume;
            if (pren) params.tertPF.prenume = pren;
            if (cnp) params.tertPF.CNP = cnp;
          }
        }
      }
    }

    // Vehicul: trimis indiferent de categorie (parity cu original — state persista dupa type switch)
    const model = bunVModel.trimmed();
    const sasiu = bunVSasiu.toParam();
    const imatr = bunVImatr.toParam();
    if (model || sasiu || imatr) {
      params.bunV = {};
      if (model) params.bunV.model = model;
      if (sasiu) params.bunV.serieSasiu = sasiu;
      if (imatr) params.bunV.nrImatriculare = imatr;
    }

    // CUI trebuie sa contina doar cifre (cf. spec RNPM). Warn non-blocking peste params-ul
    // construit deja — astfel nu validam CUI-uri din tab-uri inactive (state persista dupa switch).
    const badCui = findNonNumericCui(params);
    if (
      badCui &&
      !(await confirm({
        title: "Atentie",
        message: `CUI "${badCui}" contine caractere non-numerice. Continui cautarea?`,
        confirmLabel: "Continua",
      }))
    ) {
      return;
    }

    onSubmit(activeType, params);
  };

  const handleReset = () => {
    identificator.reset();
    setPerioadaStart("");
    setPerioadaFinal("");
    setActiv(true);
    setNemodificat(true);
    tipInscriere.reset();
    destinatie.reset();
    debPJ.reset();
    debPF.reset();
    credPJ.reset();
    credPF.reset();
    constPJ.reset();
    constPF.reset();
    fiduc.reset();
    benPJ.reset();
    benPF.reset();
    parteJ.reset();
    parteF.reset();
    bunADescriere.reset();
    creanteCred.reset();
    creanteDebJ.reset();
    creanteDebF.reset();
    creanteBunDescr.reset();
    oblAgentJ.reset();
    oblAgentF.reset();
    oblEmitent.reset();
    oblBunDescr.reset();
    bunACategorie.reset();
    bunAIdentificare.reset();
    tertJ.reset();
    tertF.reset();
    bunVModel.reset();
    bunVSasiu.reset();
    bunVImatr.reset();
    onReset?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.type}
            type="button"
            onClick={() => {
              setActiveType(cat.type);
              tipInscriere.reset();
              onTypeChange?.(cat.type);
            }}
            className={cn(
              "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
              activeType === cat.type
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="rnpm-identificator" className="mb-1 block text-xs font-medium text-muted-foreground">
            Identificator inscriere
          </label>
          <Input
            id="rnpm-identificator"
            value={identificator.value}
            onChange={(e) => identificator.setValue(e.target.value)}
            placeholder="2015-00038..."
          />
        </div>
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Select-ul Radix nu accepta id direct pe trigger, asocierea label-input se face via aria. */}
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {TIP_LABEL_BY_CATEGORY[activeType]}
          </label>
          <div className="flex gap-2">
            <Select value={tipInscriere.value} onValueChange={tipInscriere.setValue}>
              <SelectTrigger>
                <SelectValue placeholder="-- selecteaza --" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">-- selecteaza --</SelectItem>
                {TIP_AVIZ_BY_CATEGORY[activeType].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SiSauToggle value={tipInscriere.op} onChange={tipInscriere.setOp} />
          </div>
        </div>
        <div>
          <label htmlFor="rnpm-perioada-start" className="mb-1 block text-xs font-medium text-muted-foreground">
            Perioada start
          </label>
          <Input
            id="rnpm-perioada-start"
            type="date"
            value={perioadaStart}
            onChange={(e) => setPerioadaStart(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rnpm-perioada-final" className="mb-1 block text-xs font-medium text-muted-foreground">
            Perioada final
          </label>
          <Input
            id="rnpm-perioada-final"
            type="date"
            value={perioadaFinal}
            onChange={(e) => setPerioadaFinal(e.target.value)}
          />
        </div>
      </div>

      {activeType === "specifice" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Destinatia inscrierii
            </legend>
            <DestinatieSelect field={destinatie} values={DESTINATIE_INSCRIERII} />
          </fieldset>
          <PartyFieldset
            compact
            legend="Parte"
            tip={parteTip}
            onTipChange={setParteTip}
            pj={parteJ}
            pf={parteF}
            pfShowPrenume
          />
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Bun (descriere)
            </legend>
            <Input
              placeholder="Descriere"
              value={bunADescriere.value}
              onChange={(e) => bunADescriere.setValue(e.target.value)}
            />
          </fieldset>
        </div>
      ) : activeType === "fiducii" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset
            compact
            legend="Constituitor"
            tip={constTip}
            onTipChange={setConstTip}
            pj={constPJ}
            pf={constPF}
            pfNumePlaceholder="Nume complet"
          />
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fiduciar (PJ)
            </legend>
            <PJBlock field={fiduc} compact />
          </fieldset>
          <PartyFieldset
            compact
            legend="Beneficiar"
            tip={benTip}
            onTipChange={setBenTip}
            pj={benPJ}
            pf={benPF}
            pfNumePlaceholder="Nume complet"
          />
          <VehiculFieldset compact model={bunVModel} sasiu={bunVSasiu} imatr={bunVImatr} />
        </div>
      ) : activeType === "creante" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reprezentant Creditor (PJ)
            </legend>
            <PJBlock field={creanteCred} showReg compact />
          </fieldset>
          <PartyFieldset
            compact
            legend="Debitor"
            tip={creanteDebTip}
            onTipChange={setCreanteDebTip}
            pj={creanteDebJ}
            pf={creanteDebF}
            pjShowReg
            pfShowPrenume
          />
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Bun (descriere)
            </legend>
            <Input
              placeholder="Descriere"
              value={creanteBunDescr.value}
              onChange={(e) => creanteBunDescr.setValue(e.target.value)}
            />
          </fieldset>
        </div>
      ) : activeType === "obligatiuni" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset
            compact
            legend="Agent"
            tip={oblAgentTip}
            onTipChange={setOblAgentTip}
            pj={oblAgentJ}
            pf={oblAgentF}
            pjShowReg
            pfShowPrenume
          />
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Emitent (PJ)
            </legend>
            <PJBlock field={oblEmitent} showReg compact />
          </fieldset>
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Creante (descriere)
            </legend>
            <Input
              placeholder="Descriere"
              value={oblBunDescr.value}
              onChange={(e) => oblBunDescr.setValue(e.target.value)}
            />
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset
            compact
            legend="Debitor"
            tip={debTip}
            onTipChange={setDebTip}
            pj={debPJ}
            pf={debPF}
            pfShowPrenume
          />
          <PartyFieldset
            compact
            legend="Creditor"
            tip={credTip}
            onTipChange={setCredTip}
            pj={credPJ}
            pf={credPF}
            pfShowPrenume
          />
          {activeType === "ipoteci" && (
            <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Destinatia inscrierii
              </legend>
              <DestinatieSelect field={destinatie} values={DESTINATIE_IPOTECI} />
            </fieldset>
          )}
          <VehiculFieldset compact collapsible model={bunVModel} sasiu={bunVSasiu} imatr={bunVImatr} cols={3} />
          {activeType === "ipoteci" && (
            <CollapsibleFieldset legend="Bun (alt tip) & Tert cedat" compact colSpan2>
              <div className="grid gap-3 md:grid-cols-2">
                <fieldset className="rounded-lg border border-border p-2">
                  <legend className="ml-[1.125rem] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Bun (alt tip)
                  </legend>
                  <div className="grid gap-1.5">
                    <Select value={bunACategorie.value} onValueChange={bunACategorie.setValue}>
                      <SelectTrigger>
                        <SelectValue placeholder="-- selecteaza categorie --" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- selecteaza categorie --</SelectItem>
                        {BUN_ALT_TIP_CATEGORII.map((label, i) => (
                          <SelectItem key={label} value={String(i + 1)}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SiSauInput
                      placeholder="Identificare bun"
                      value={bunAIdentificare.value}
                      onChange={bunAIdentificare.setValue}
                      op={bunAIdentificare.op}
                      onOpChange={bunAIdentificare.setOp}
                    />
                  </div>
                </fieldset>
                <PartyFieldset
                  compact
                  legend="Tert cedat"
                  tip={tertTip}
                  onTipChange={setTertTip}
                  pj={tertJ}
                  pf={tertF}
                  pjShowReg
                  pfShowPrenume
                />
              </div>
            </CollapsibleFieldset>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-blue-600"
            checked={activ === true}
            onChange={(e) => setActiv(e.target.checked ? true : undefined)}
          />
          Numai active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-blue-600"
            checked={nemodificat === true}
            onChange={(e) => setNemodificat(e.target.checked ? true : undefined)}
          />
          Nemodificate de alte inscrieri
        </label>
        <div className="ml-auto flex items-center gap-2">
          {loading && loadingPhase && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {loadingPhase}
            </span>
          )}
          {loading && onStop && !suppressStop ? (
            <Button
              key="rnpm-stop-btn"
              type="button"
              onClick={onStop}
              className="font-normal h-8 px-3 text-xs bg-red-600 text-white hover:bg-red-700"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          ) : (
            <Button key="rnpm-submit-btn" type="submit" disabled={loading} className="font-normal h-8 px-3 text-xs">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Cauta
            </Button>
          )}
          {extraActions}
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={loading}
            className="font-normal h-8 px-3 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>
    </form>
  );
}
