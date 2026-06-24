import { useState } from "react";
import type { RnpmSiSau } from "@/types/rnpm";

export function useText(init = "") {
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
export type TextField = ReturnType<typeof useText>;

export function useSiSauField(init?: RnpmSiSau) {
  const [value, setValue] = useState(init?.value ?? "");
  const [op, setOp] = useState<"1" | "2">(init?.type ?? "1");
  return {
    value,
    setValue,
    op,
    setOp,
    reset: () => {
      setValue("");
      setOp("1");
    },
    toParam: (): RnpmSiSau | undefined => {
      const v = value.trim();
      return v ? { type: op, value: v } : undefined;
    },
  };
}
export type SiSauField = ReturnType<typeof useSiSauField>;

export function usePJField(init?: { denumire?: string; CUI?: RnpmSiSau; RegCom?: RnpmSiSau; regCom?: RnpmSiSau }) {
  const denumire = useText(init?.denumire);
  const cui = useSiSauField(init?.CUI);
  const reg = useSiSauField(init?.RegCom ?? init?.regCom);
  return {
    denumire,
    cui,
    reg,
    reset: () => {
      denumire.reset();
      cui.reset();
      reg.reset();
    },
  };
}
export type PJField = ReturnType<typeof usePJField>;

export function usePFField(init?: { nume?: string; prenume?: RnpmSiSau; CNP?: RnpmSiSau }) {
  const nume = useText(init?.nume);
  const prenume = useSiSauField(init?.prenume);
  const cnp = useSiSauField(init?.CNP);
  return {
    nume,
    prenume,
    cnp,
    reset: () => {
      nume.reset();
      prenume.reset();
      cnp.reset();
    },
  };
}
export type PFField = ReturnType<typeof usePFField>;
