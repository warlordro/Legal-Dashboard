import { useState } from "react";
import { Search, Loader2, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RnpmSearchParams, RnpmSearchType, RnpmSiSau } from "@/types/rnpm";

// Bun "Alt tip" la ipoteci — RNPM trimite `bunA.categorie` ca index string (1..11)
// in ordinea din dropdown-ul oficial. Confirmat prin captura Network: "recolte" = "6".
const BUN_ALT_TIP_CATEGORII = [
  "creante conf. art. 2389 lit. a) si b) din Codul civil",
  "cont bancar",
  "actiuni/parti sociale/valori mobiliare/alte instrumente financiare",
  "echipamente/instalatii/alte bunuri destinate sa serveasca exploatarii unei intreprinderi",
  "polite de asigurare",
  "recolte",
  "utilaje agricole, altele decat autovehicule",
  "efective de animale",
  "universalitati",
  "inscriere veche",
  "alte bunuri",
];

const DESTINATIE_IPOTECI = [
  "creditor garantat/debitor",
  "locatar/locator",
  "consignatar/consignant",
  "vanzator/cumparator",
  "obligatii agricole",
  "inscrieri in legatura cu finantele publice",
  "preluat de datoria publica",
  "alte inscrieri",
  "sechestru",
  "sechestru scutit de taxa",
];

const DESTINATIE_INSCRIERII = [
  "publicitatea clauzei de insesizabilitate",
  "publicitatea clauzei de inalienabilitate",
  "publicitatea clauzei de rezerva a proprietatii",
  "publicitatea pactului de rascumparare",
  "publicitatea cesiunii de creanta",
  "publicitatea declaratiei de rezolutiune",
  "publicitatea declaratiei de reziliere",
  "publicitatea hotararii judecatoresti privind actele de dispozitie care pun in pericol grav interesele familiei",
  "publicitatea regimului matrimonial",
  "publicitatea uzufructului asupra creantelor",
  "publicitatea platii anticipate a chiriei",
  "publicitatea cesiunii creantei privind chiria",
  "publicitatea titlurilor executorii constatate prin inscrisuri sub semnatura privata",
  "alte acte/fapte juridice supuse publicitatii conform legii",
];

const TIP_AVIZ_BY_CATEGORY: Record<RnpmSearchType, string[]> = {
  ipoteci: [
    "aviz initial", "cesiune a creantei", "extindere", "intentie", "modificator",
    "nulitate", "prelungire", "reducere", "stingere", "transformare", "executare",
    "preluare", "schimbarea rangului", "mentinere", "cesiunea rangului ipotecii",
    "reactivare", "actualizare", "indreptare a erorii materiale",
  ],
  specifice: [
    "aviz initial", "modificare", "stingere", "nulitate", "prelungire",
    "reactivare", "indreptare a erorii materiale",
  ],
  fiducii: [
    "aviz initial", "acceptare", "modificare", "nulitate", "stingere",
    "reactivare", "indreptare a erorii materiale",
  ],
  creante: [
    "aviz initial", "modificare", "extindere", "reducere", "stingere",
    "nulitate", "prelungire", "reactivare", "indreptare a erorii materiale",
  ],
  obligatiuni: [
    "aviz initial", "modificare", "extindere", "reducere", "stingere",
    "nulitate", "prelungire", "reactivare", "indreptare a erorii materiale",
  ],
};

// Label-ul dropdown-ului de tip difera per categorie pe site-ul RNPM oficial.
const TIP_LABEL_BY_CATEGORY: Record<RnpmSearchType, string> = {
  ipoteci: "Tipul inregistrarii",
  creante: "Tipul inregistrarii",
  fiducii: "Tipul fiduciei",
  specifice: "Tipul avizului",
  obligatiuni: "Tipul avizului",
};

const CATEGORIES: { type: RnpmSearchType; label: string }[] = [
  { type: "ipoteci", label: "Aviz de ipoteca mobiliara" },
  { type: "fiducii", label: "Fiducie" },
  { type: "specifice", label: "Aviz specific" },
  { type: "creante", label: "Aviz de ipoteca - creante securitizate" },
  { type: "obligatiuni", label: "Aviz de ipoteca - obligatiuni ipotecare" },
];

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

// ---- Custom hooks: collapse per-field state boilerplate ----

function useText(init = "") {
  const [value, setValue] = useState(init);
  return {
    value,
    setValue,
    reset: () => setValue(""),
    trimmed: (): string | undefined => {
      const v = value.trim();
      return v ? v : undefined;
    },
  };
}
type TextField = ReturnType<typeof useText>;

function useSiSauField(init?: RnpmSiSau) {
  const [value, setValue] = useState(init?.value ?? "");
  const [op, setOp] = useState<"1" | "2">(init?.type ?? "1");
  return {
    value,
    setValue,
    op,
    setOp,
    reset: () => { setValue(""); setOp("1"); },
    toParam: (): RnpmSiSau | undefined => {
      const v = value.trim();
      return v ? { type: op, value: v } : undefined;
    },
  };
}
type SiSauField = ReturnType<typeof useSiSauField>;

function usePJField(init?: { denumire?: string; CUI?: RnpmSiSau; RegCom?: RnpmSiSau; regCom?: RnpmSiSau }) {
  const denumire = useText(init?.denumire);
  const cui = useSiSauField(init?.CUI);
  const reg = useSiSauField(init?.RegCom ?? init?.regCom);
  return {
    denumire, cui, reg,
    reset: () => { denumire.reset(); cui.reset(); reg.reset(); },
  };
}
type PJField = ReturnType<typeof usePJField>;

function usePFField(init?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau }) {
  const nume = useText(init?.nume);
  const prenume = useSiSauField(init?.prenume);
  const cnp = useSiSauField(init?.CNP);
  return {
    nume, prenume, cnp,
    reset: () => { nume.reset(); prenume.reset(); cnp.reset(); },
  };
}
type PFField = ReturnType<typeof usePFField>;

// ---- Section sub-components ----

function PJBlock({ field, showReg = false, compact = false }: { field: PJField; showReg?: boolean; compact?: boolean }) {
  // Compact: layout orizontal (2 sau 3 coloane in functie de showReg) pe ecrane >=md.
  const wrapCls = compact
    ? cn("grid gap-1.5", showReg ? "md:grid-cols-3" : "md:grid-cols-2")
    : "space-y-2";
  return (
    <div className={wrapCls}>
      <Input placeholder="Denumire" value={field.denumire.value} onChange={(e) => field.denumire.setValue(e.target.value)} />
      {showReg && (
        <SiSauInput placeholder="Nr. Reg. Comertului" value={field.reg.value} onChange={field.reg.setValue} op={field.reg.op} onOpChange={field.reg.setOp} />
      )}
      <SiSauInput placeholder="CUI" value={field.cui.value} onChange={field.cui.setValue} op={field.cui.op} onOpChange={field.cui.setOp} />
    </div>
  );
}

function PFBlock({ field, showPrenume = false, numePlaceholder = "Nume", compact = false }: { field: PFField; showPrenume?: boolean; numePlaceholder?: string; compact?: boolean }) {
  const wrapCls = compact
    ? cn("grid gap-1.5", showPrenume ? "md:grid-cols-3" : "md:grid-cols-2")
    : "space-y-2";
  return (
    <div className={wrapCls}>
      <Input placeholder={numePlaceholder} value={field.nume.value} onChange={(e) => field.nume.setValue(e.target.value)} />
      {showPrenume && (
        <SiSauInput placeholder="Prenume" value={field.prenume.value} onChange={field.prenume.setValue} op={field.prenume.op} onOpChange={field.prenume.setOp} />
      )}
      <SiSauInput placeholder="CNP" value={field.cnp.value} onChange={field.cnp.setValue} op={field.cnp.op} onOpChange={field.cnp.setOp} />
    </div>
  );
}

function PartyFieldset({
  legend, tip, onTipChange, pj, pf,
  pjShowReg = false, pfShowPrenume = false, pfNumePlaceholder = "Nume", compact = false,
}: {
  legend: string;
  tip: "PJ" | "PF";
  onTipChange: (v: "PJ" | "PF") => void;
  pj: PJField;
  pf: PFField;
  pjShowReg?: boolean;
  pfShowPrenume?: boolean;
  pfNumePlaceholder?: string;
  compact?: boolean;
}) {
  return (
    <fieldset className={cn("rounded-lg border border-border", compact ? "p-2" : "p-3")}>
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{legend}</legend>
      <PJPFToggle value={tip} onChange={onTipChange} />
      {tip === "PJ"
        ? <PJBlock field={pj} showReg={pjShowReg} compact={compact} />
        : <PFBlock field={pf} showPrenume={pfShowPrenume} numePlaceholder={pfNumePlaceholder} compact={compact} />}
    </fieldset>
  );
}

function VehiculFieldset({ model, sasiu, imatr, cols = 1, compact = false }: { model: TextField; sasiu: SiSauField; imatr: SiSauField; cols?: 1 | 3; compact?: boolean }) {
  const gridCls = cols === 3 ? "grid gap-2 md:grid-cols-3" : "space-y-2";
  return (
    <fieldset className={cn("rounded-lg border border-border", compact ? "p-2" : "p-3", cols === 3 && "md:col-span-2")}>
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vehicul (bun garantat)</legend>
      <div className={gridCls}>
        <Input placeholder="Model" value={model.value} onChange={(e) => model.setValue(e.target.value)} />
        <SiSauInput placeholder="Serie sasiu" value={sasiu.value} onChange={sasiu.setValue} op={sasiu.op} onOpChange={sasiu.setOp} />
        <SiSauInput placeholder="Nr. inmatriculare" value={imatr.value} onChange={imatr.setValue} op={imatr.op} onOpChange={imatr.setOp} />
      </div>
    </fieldset>
  );
}

function DestinatieSelect({ field, values }: { field: SiSauField; values: string[] }) {
  return (
    <div className="flex gap-2">
      <select
        value={field.value}
        onChange={(e) => field.setValue(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">-- selecteaza --</option>
        {values.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <SiSauToggle value={field.op} onChange={field.setOp} />
    </div>
  );
}

// ---- Main form ----

export interface RnpmSearchFormProps {
  loading: boolean;
  loadingPhase?: string;
  onSubmit: (type: RnpmSearchType, params: RnpmSearchParams) => void;
  onStop?: () => void;
  onReset?: () => void;
  initialType?: RnpmSearchType;
  initialParams?: RnpmSearchParams;
  extraActions?: React.ReactNode;
}

export function RnpmSearchForm({ loading, loadingPhase, onSubmit, onStop, onReset, initialType, initialParams, extraActions }: RnpmSearchFormProps) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params: RnpmSearchParams = {};

    const idTrim = identificator.trimmed();
    if (idTrim) params.identificatorInscriere = idTrim;
    if (perioadaStart) params.perioadaStart = perioadaStart;
    if (perioadaFinal) params.perioadaFinal = perioadaFinal;
    if (activ != null) params.activ = activ;
    if (nemodificat != null) params.nemodificat = nemodificat;
    const tipInsc = tipInscriere.toParam();
    if (tipInsc) params.tipInscriere = tipInsc;

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
        // CreditorPF: fara prenume (parity cu original)
        const nume = credPF.nume.trimmed();
        const cnp = credPF.cnp.toParam();
        if (nume || cnp) {
          params.CreditorPF = {};
          if (nume) params.CreditorPF.nume = nume;
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
    if (badCui && !window.confirm(`Atentie: CUI "${badCui}" contine caractere non-numerice. Continui cautarea?`)) {
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
    debPJ.reset(); debPF.reset();
    credPJ.reset(); credPF.reset();
    constPJ.reset(); constPF.reset();
    fiduc.reset();
    benPJ.reset(); benPF.reset();
    parteJ.reset(); parteF.reset();
    bunADescriere.reset();
    creanteCred.reset();
    creanteDebJ.reset(); creanteDebF.reset();
    creanteBunDescr.reset();
    oblAgentJ.reset(); oblAgentF.reset();
    oblEmitent.reset();
    oblBunDescr.reset();
    bunACategorie.reset(); bunAIdentificare.reset();
    tertJ.reset(); tertF.reset();
    bunVModel.reset(); bunVSasiu.reset(); bunVImatr.reset();
    onReset?.();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.type}
            type="button"
            onClick={() => { setActiveType(cat.type); tipInscriere.reset(); }}
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
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Identificator inscriere</label>
          <Input value={identificator.value} onChange={(e) => identificator.setValue(e.target.value)} placeholder="2015-00038..." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {TIP_LABEL_BY_CATEGORY[activeType]}
          </label>
          <div className="flex gap-2">
            <select
              value={tipInscriere.value}
              onChange={(e) => tipInscriere.setValue(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">-- selecteaza --</option>
              {TIP_AVIZ_BY_CATEGORY[activeType].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <SiSauToggle value={tipInscriere.op} onChange={tipInscriere.setOp} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Perioada start</label>
          <Input type="date" value={perioadaStart} onChange={(e) => setPerioadaStart(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Perioada final</label>
          <Input type="date" value={perioadaFinal} onChange={(e) => setPerioadaFinal(e.target.value)} />
        </div>
      </div>

      {activeType === "specifice" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destinatia inscrierii</legend>
            <DestinatieSelect field={destinatie} values={DESTINATIE_INSCRIERII} />
          </fieldset>
          <PartyFieldset compact legend="Parte" tip={parteTip} onTipChange={setParteTip} pj={parteJ} pf={parteF} pfShowPrenume />
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bun (descriere)</legend>
            <Input placeholder="Descriere" value={bunADescriere.value} onChange={(e) => bunADescriere.setValue(e.target.value)} />
          </fieldset>
        </div>
      ) : activeType === "fiducii" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset compact legend="Constituitor" tip={constTip} onTipChange={setConstTip} pj={constPJ} pf={constPF} pfNumePlaceholder="Nume complet" />
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fiduciar (PJ)</legend>
            <PJBlock field={fiduc} compact />
          </fieldset>
          <PartyFieldset compact legend="Beneficiar" tip={benTip} onTipChange={setBenTip} pj={benPJ} pf={benPF} pfNumePlaceholder="Nume complet" />
          <VehiculFieldset compact model={bunVModel} sasiu={bunVSasiu} imatr={bunVImatr} />
        </div>
      ) : activeType === "creante" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reprezentant Creditor (PJ)</legend>
            <PJBlock field={creanteCred} showReg compact />
          </fieldset>
          <PartyFieldset compact legend="Debitor" tip={creanteDebTip} onTipChange={setCreanteDebTip} pj={creanteDebJ} pf={creanteDebF} pjShowReg pfShowPrenume />
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bun (descriere)</legend>
            <Input placeholder="Descriere" value={creanteBunDescr.value} onChange={(e) => creanteBunDescr.setValue(e.target.value)} />
          </fieldset>
        </div>
      ) : activeType === "obligatiuni" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset compact legend="Agent" tip={oblAgentTip} onTipChange={setOblAgentTip} pj={oblAgentJ} pf={oblAgentF} pjShowReg pfShowPrenume />
          <fieldset className="rounded-lg border border-border p-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emitent (PJ)</legend>
            <PJBlock field={oblEmitent} showReg compact />
          </fieldset>
          <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Creante (descriere)</legend>
            <Input placeholder="Descriere" value={oblBunDescr.value} onChange={(e) => oblBunDescr.setValue(e.target.value)} />
          </fieldset>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <PartyFieldset compact legend="Debitor" tip={debTip} onTipChange={setDebTip} pj={debPJ} pf={debPF} pfShowPrenume />
          <PartyFieldset compact legend="Creditor" tip={credTip} onTipChange={setCredTip} pj={credPJ} pf={credPF} pfNumePlaceholder="Nume complet" />
          {activeType === "ipoteci" && (
            <fieldset className="rounded-lg border border-border p-2 md:col-span-2">
              <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destinatia inscrierii</legend>
              <DestinatieSelect field={destinatie} values={DESTINATIE_IPOTECI} />
            </fieldset>
          )}
          <VehiculFieldset compact model={bunVModel} sasiu={bunVSasiu} imatr={bunVImatr} cols={3} />
          {activeType === "ipoteci" && (
            <>
              <fieldset className="rounded-lg border border-border p-2">
                <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bun (alt tip)</legend>
                <div className="grid gap-1.5">
                  <select
                    value={bunACategorie.value}
                    onChange={(e) => bunACategorie.setValue(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- selecteaza categorie --</option>
                    {BUN_ALT_TIP_CATEGORII.map((label, i) => (
                      <option key={label} value={String(i + 1)}>{label}</option>
                    ))}
                  </select>
                  <SiSauInput placeholder="Identificare bun" value={bunAIdentificare.value} onChange={bunAIdentificare.setValue} op={bunAIdentificare.op} onOpChange={bunAIdentificare.setOp} />
                </div>
              </fieldset>
              <PartyFieldset compact legend="Tert cedat" tip={tertTip} onTipChange={setTertTip} pj={tertJ} pf={tertF} pjShowReg pfShowPrenume />
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activ === true}
            onChange={(e) => setActiv(e.target.checked ? true : undefined)}
          />
          Numai active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
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
          {loading && onStop ? (
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
          <Button type="button" variant="outline" onClick={handleReset} disabled={loading} className="font-normal h-8 px-3 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---- Low-level helper components ----

function SiSauInput({ placeholder, value, onChange, op, onOpChange }: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  op: "1" | "2";
  onOpChange: (v: "1" | "2") => void;
}) {
  return (
    <div className="flex gap-2">
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <SiSauToggle value={op} onChange={onOpChange} />
    </div>
  );
}

function SiSauToggle({ value, onChange }: { value: "1" | "2"; onChange: (v: "1" | "2") => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-input px-1">
      {(["1", "2"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          {v === "1" ? "SI" : "SAU"}
        </button>
      ))}
    </div>
  );
}

function PJPFToggle({ value, onChange }: { value: "PJ" | "PF"; onChange: (v: "PJ" | "PF") => void }) {
  return (
    <div className="mb-2 flex gap-1">
      {(["PJ", "PF"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            value === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
          )}
        >
          {t === "PJ" ? "Persoana Juridica" : "Persoana Fizica"}
        </button>
      ))}
    </div>
  );
}
