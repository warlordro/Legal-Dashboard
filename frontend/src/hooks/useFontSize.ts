import { useEffect, useRef, useState } from "react";

// v2.41.0: stocarea trece de la INDEX de treapta la VALOAREA px — un array de
// trepte care se schimba intre versiuni invalideaza indexii salvati, dar un px
// ramane stabil semantic. Valorile legacy 0..3 (vechiul array de 4 trepte) se
// mapeaza prin LEGACY_INDEX_PX ca alegerile existente sa nu se piarda.
const STORAGE_KEY = "portaljust-font-size";
const MIGRATION_KEY = "portaljust-font-size-migrated-v241";
const STEPS = [
  { label: "Foarte mic", value: 14 },
  { label: "Mic", value: 16 },
  { label: "Normal", value: 18 },
  { label: "Mare", value: 20 },
  { label: "Extra", value: 22 },
];
const LEGACY_INDEX_PX = [16, 18, 20, 22];

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.desktopApi !== undefined;
}

// Desktop pastreaza default-ul istoric (18px); in browser UI-ul e dimensionat
// pentru 16px — 18px era una din cauzele "tot UI-ul e marit" raportate pe web.
function defaultPx(): number {
  return isDesktopRuntime() ? 18 : 16;
}

// Migrare one-time (web): vechiul hook persista default-ul ("1" = index 18px)
// la fiecare mount, deci prezenta lui in storage NU inseamna alegere explicita.
// Stergem DOAR valoarea auto-persistata de vechiul default ("1" sau "18");
// orice alta valoare e o alegere reala (Mic/Mare/Extra) si SE PASTREAZA.
function migrateAutoPersistedDefault(): void {
  if (isDesktopRuntime()) return;
  try {
    if (localStorage.getItem(MIGRATION_KEY) !== null) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1" || saved === "18") {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(MIGRATION_KEY, "1");
  } catch {
    /* localStorage unavailable (private mode / quota); nothing to migrate */
  }
}

function loadPx(): number {
  try {
    migrateAutoPersistedDefault();
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const n = Number(saved);
      if (Number.isInteger(n) && n >= 0 && n < LEGACY_INDEX_PX.length) return LEGACY_INDEX_PX[n];
      if (STEPS.some((s) => s.value === n)) return n;
    }
  } catch {
    /* localStorage unavailable (private mode / quota); use default */
  }
  return defaultPx();
}

function pxToStep(px: number): number {
  const idx = STEPS.findIndex((s) => s.value === px);
  return idx === -1 ? STEPS.findIndex((s) => s.value === defaultPx()) : idx;
}

function applyFontSize(step: number) {
  document.documentElement.style.fontSize = `${STEPS[step].value}px`;
}

export function useFontSize() {
  const [step, setStepState] = useState(() => pxToStep(loadPx()));
  // Persistam DOAR la alegere explicita: efectul de mount aplica font-size-ul
  // dar nu scrie storage — altfel default-ul devine "alegere" si migrarile
  // viitoare nu mai pot distinge intre ele (exact bug-ul reparat mai sus).
  const userChangedRef = useRef(false);

  useEffect(() => {
    applyFontSize(step);
    if (!userChangedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(STEPS[step].value));
    } catch {
      /* localStorage unavailable; font-size-ul ramane aplicat pe sesiune */
    }
  }, [step]);

  const setStep = (i: number) => {
    userChangedRef.current = true;
    setStepState(Math.min(Math.max(i, 0), STEPS.length - 1));
  };
  const increase = () => {
    userChangedRef.current = true;
    setStepState((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const decrease = () => {
    userChangedRef.current = true;
    setStepState((s) => Math.max(s - 1, 0));
  };
  const cycle = () => {
    userChangedRef.current = true;
    setStepState((s) => (s + 1) % STEPS.length);
  };

  return {
    step,
    label: STEPS[step].label,
    value: STEPS[step].value,
    steps: STEPS,
    increase,
    decrease,
    cycle,
    setStep,
    canIncrease: step < STEPS.length - 1,
    canDecrease: step > 0,
  };
}
