import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "portaljust-font-size";
// v2.41.0: pana la acest release effect-ul de mount persista automat step-ul
// curent, deci userii web au "1" (18px) scris in storage fara sa-l fi ales.
// Flag-ul marcheaza resetul one-time pe web ca noul default (16px) sa se aplice.
const WEB_MIGRATION_KEY = "portaljust-font-size-migrated-v241";
const STEPS = [
  { label: "Foarte mic", value: 14 },
  { label: "Mic", value: 16 },
  { label: "Normal", value: 18 },
  { label: "Mare", value: 20 },
  { label: "Extra", value: 22 },
];

// Pre-v2.41.0 preferinta se stoca drept INDEX in vechiul array [16,18,20,22].
// Acum se stocheaza valoarea px — imun la modificari viitoare ale listei.
const LEGACY_INDEX_PX = [16, 18, 20, 22];

const isDesktop = typeof window !== "undefined" && !!window.desktopApi;

// Desktop: Normal (18px) — compensat vizual de zoom-ul 0.9 aplicat de Electron
// la primul launch (main.js). Web: Mic (16px) — baseline browser, fara zoom.
const DEFAULT_STEP = STEPS.findIndex((s) => s.value === (isDesktop ? 18 : 16));

function migrateWebAutoPersistedValue() {
  if (isDesktop) return;
  try {
    if (localStorage.getItem(WEB_MIGRATION_KEY) !== null) return;
    // CodeRabbit (PR #65): sterge DOAR valoarea auto-persistata de vechiul
    // default (index legacy "1" = 18px). Orice alta valoare inseamna ca userul
    // a ales explicit alta treapta (Mic/Mare/Extra) — alegerea se pastreaza.
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1" || saved === "18") {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(WEB_MIGRATION_KEY, "1");
  } catch {
    /* localStorage unavailable — nothing to migrate */
  }
}

function loadStep(): number {
  // Ordinea conteaza: migrarea ruleaza inainte de citire, altfel valoarea
  // auto-persistata veche ar fi onorata inaintea noului default.
  migrateWebAutoPersistedValue();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const n = Number(saved);
      // Format curent: valoare px (14/16/18/20/22).
      const byValue = STEPS.findIndex((s) => s.value === n);
      if (byValue >= 0) return byValue;
      // Format legacy: index 0..3 in vechiul array — mapat la px-ul de atunci,
      // ca "Normal 18px" salvat pe desktop sa ramana 18px si dupa extinderea listei.
      if (Number.isInteger(n) && n >= 0 && n < LEGACY_INDEX_PX.length) {
        return STEPS.findIndex((s) => s.value === LEGACY_INDEX_PX[n]);
      }
    }
  } catch {
    /* localStorage unavailable (private mode / quota); use default */
  }
  return DEFAULT_STEP;
}

function applyFontSize(step: number) {
  document.documentElement.style.fontSize = `${STEPS[step].value}px`;
}

export function useFontSize() {
  const [step, setStepState] = useState(loadStep);
  // Persistam DOAR alegerile explicite ale userului; default-urile nealese nu
  // se scriu in storage (auto-persist-ul de mount ingheta vechiul default).
  const userChangedRef = useRef(false);

  useEffect(() => {
    applyFontSize(step);
    if (!userChangedRef.current) return;
    try {
      // Se stocheaza px-ul, nu indexul (vezi LEGACY_INDEX_PX).
      localStorage.setItem(STORAGE_KEY, String(STEPS[step].value));
    } catch {
      /* quota / private mode — ramane doar in memorie */
    }
  }, [step]);

  const setStep: typeof setStepState = (value) => {
    userChangedRef.current = true;
    setStepState(value);
  };

  const increase = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const decrease = () => setStep((s) => Math.max(s - 1, 0));
  const cycle = () => setStep((s) => (s + 1) % STEPS.length);

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
