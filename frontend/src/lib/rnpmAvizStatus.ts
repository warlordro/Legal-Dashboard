export type RnpmActivValue = boolean | null | undefined;

export interface RnpmAvizStatusDisplay {
  label: "Activ" | "Stins" | "Necunoscut";
  badgeClassName: string;
}

export function getRnpmAvizStatusDisplay(activ: RnpmActivValue): RnpmAvizStatusDisplay {
  if (activ === true) {
    return {
      label: "Activ",
      badgeClassName:
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    };
  }
  if (activ === false) {
    return {
      label: "Stins",
      badgeClassName:
        "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300",
    };
  }
  return {
    label: "Necunoscut",
    badgeClassName:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  };
}

export function formatRnpmAvizStatus(activ: RnpmActivValue): RnpmAvizStatusDisplay["label"] {
  return getRnpmAvizStatusDisplay(activ).label;
}
