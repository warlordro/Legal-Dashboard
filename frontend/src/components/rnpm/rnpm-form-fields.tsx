import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PJField, PFField, SiSauField, TextField } from "./rnpm-form-hooks";

// Container pliabil cu legenda-buton. Starea e locala (collapse = doar UI, nu afecteaza submit-ul).
export function CollapsibleFieldset({
  legend,
  defaultOpen = false,
  compact = false,
  colSpan2 = false,
  children,
}: { legend: string; defaultOpen?: boolean; compact?: boolean; colSpan2?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className={cn("rounded-lg border border-border", compact ? "p-2" : "p-3", colSpan2 && "md:col-span-2")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        {legend}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </fieldset>
  );
}

export function SiSauInput({
  placeholder,
  value,
  onChange,
  op,
  onOpChange,
}: {
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

export function SiSauToggle({ value, onChange }: { value: "1" | "2"; onChange: (v: "1" | "2") => void }) {
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

export function PJPFToggle({ value, onChange }: { value: "PJ" | "PF"; onChange: (v: "PJ" | "PF") => void }) {
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

export function PJBlock({
  field,
  showReg = false,
  compact = false,
}: { field: PJField; showReg?: boolean; compact?: boolean }) {
  // Compact: layout orizontal (2 sau 3 coloane in functie de showReg) pe ecrane >=md.
  const wrapCls = compact ? cn("grid gap-1.5", showReg ? "md:grid-cols-3" : "md:grid-cols-2") : "space-y-2";
  return (
    <div className={wrapCls}>
      <Input
        placeholder="Denumire"
        value={field.denumire.value}
        onChange={(e) => field.denumire.setValue(e.target.value)}
      />
      {showReg && (
        <SiSauInput
          placeholder="Nr. Reg. Comertului"
          value={field.reg.value}
          onChange={field.reg.setValue}
          op={field.reg.op}
          onOpChange={field.reg.setOp}
        />
      )}
      <SiSauInput
        placeholder="CUI"
        value={field.cui.value}
        onChange={field.cui.setValue}
        op={field.cui.op}
        onOpChange={field.cui.setOp}
      />
    </div>
  );
}

export function PFBlock({
  field,
  showPrenume = false,
  numePlaceholder = "Nume",
  compact = false,
}: { field: PFField; showPrenume?: boolean; numePlaceholder?: string; compact?: boolean }) {
  // Compact cu Prenume: CNP merge pe rand propriu ca sa aiba loc pentru toate 13 cifrele chiar
  // si cand fieldset-ul sta pe jumatate de container (Debitor + Creditor lipite). Nume + Prenume
  // impart primul rand 50/50. Restul cazurilor (non-compact, sau compact fara Prenume) raman inline.
  if (compact && showPrenume) {
    // Grid unificat 1fr_1fr_auto: rand 1 = Nume | Prenume | SI/SAU(Prenume); rand 2 = CNP
    // (span 2 col) | SI/SAU(CNP). Cele doua toggle-uri SI/SAU se stivuiesc vertical la dreapta,
    // iar Nume si Prenume au latime input identica (fara spacer artificial).
    return (
      <div className="grid gap-1.5 md:grid-cols-[1fr_1fr_auto]">
        <Input
          placeholder={numePlaceholder}
          value={field.nume.value}
          onChange={(e) => field.nume.setValue(e.target.value)}
        />
        <Input
          placeholder="Prenume"
          value={field.prenume.value}
          onChange={(e) => field.prenume.setValue(e.target.value)}
        />
        <SiSauToggle value={field.prenume.op} onChange={field.prenume.setOp} />
        <Input placeholder="CNP" value={field.cnp.value} onChange={(e) => field.cnp.setValue(e.target.value)} />
        <div aria-hidden />
        <SiSauToggle value={field.cnp.op} onChange={field.cnp.setOp} />
      </div>
    );
  }
  const wrapCls = compact ? "grid gap-1.5 md:grid-cols-[1fr_minmax(210px,1.4fr)]" : "space-y-2";
  return (
    <div className={wrapCls}>
      <Input
        placeholder={numePlaceholder}
        value={field.nume.value}
        onChange={(e) => field.nume.setValue(e.target.value)}
      />
      <SiSauInput
        placeholder="CNP"
        value={field.cnp.value}
        onChange={field.cnp.setValue}
        op={field.cnp.op}
        onOpChange={field.cnp.setOp}
      />
    </div>
  );
}

export function PartyFieldset({
  legend,
  tip,
  onTipChange,
  pj,
  pf,
  pjShowReg = false,
  pfShowPrenume = false,
  pfNumePlaceholder = "Nume",
  compact = false,
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
      {tip === "PJ" ? (
        <PJBlock field={pj} showReg={pjShowReg} compact={compact} />
      ) : (
        <PFBlock field={pf} showPrenume={pfShowPrenume} numePlaceholder={pfNumePlaceholder} compact={compact} />
      )}
    </fieldset>
  );
}

export function VehiculFieldset({
  model,
  sasiu,
  imatr,
  cols = 1,
  compact = false,
  collapsible = false,
}: { model: TextField; sasiu: SiSauField; imatr: SiSauField; cols?: 1 | 3; compact?: boolean; collapsible?: boolean }) {
  const gridCls = cols === 3 ? "grid gap-2 md:grid-cols-3" : "space-y-2";
  const body = (
    <div className={gridCls}>
      <Input placeholder="Model" value={model.value} onChange={(e) => model.setValue(e.target.value)} />
      <SiSauInput
        placeholder="Serie sasiu"
        value={sasiu.value}
        onChange={sasiu.setValue}
        op={sasiu.op}
        onOpChange={sasiu.setOp}
      />
      <SiSauInput
        placeholder="Nr. inmatriculare"
        value={imatr.value}
        onChange={imatr.setValue}
        op={imatr.op}
        onOpChange={imatr.setOp}
      />
    </div>
  );
  if (collapsible) {
    return (
      <CollapsibleFieldset legend="Vehicul (bun garantat)" compact={compact} colSpan2={cols === 3}>
        {body}
      </CollapsibleFieldset>
    );
  }
  return (
    <fieldset className={cn("rounded-lg border border-border", compact ? "p-2" : "p-3", cols === 3 && "md:col-span-2")}>
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Vehicul (bun garantat)
      </legend>
      {body}
    </fieldset>
  );
}

export function DestinatieSelect({ field, values }: { field: SiSauField; values: string[] }) {
  return (
    <div className="flex gap-2">
      <Select value={field.value} onValueChange={field.setValue}>
        <SelectTrigger>
          <SelectValue placeholder="-- selecteaza --" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">-- selecteaza --</SelectItem>
          {values.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SiSauToggle value={field.op} onChange={field.setOp} />
    </div>
  );
}
