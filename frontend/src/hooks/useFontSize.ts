import { useState, useEffect } from "react";

const STORAGE_KEY = "portaljust-font-size";
const STEPS = [
  { label: "Mic", value: 16 },
  { label: "Normal", value: 18 },
  { label: "Mare", value: 20 },
  { label: "Extra", value: 22 },
];

function loadStep(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const n = Number(saved);
      if (n >= 0 && n < STEPS.length) return n;
    }
  } catch { /* localStorage unavailable (private mode / quota); use default */ }
  return 1; // Default: Normal (16px)
}

function applyFontSize(step: number) {
  document.documentElement.style.fontSize = `${STEPS[step].value}px`;
}

export function useFontSize() {
  const [step, setStep] = useState(loadStep);

  useEffect(() => {
    applyFontSize(step);
    localStorage.setItem(STORAGE_KEY, String(step));
  }, [step]);

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
