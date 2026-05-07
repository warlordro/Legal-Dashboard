import type { RnpmSplitProgress, RnpmNestedSplitProgress } from "@/types/rnpm";

export function describeSplitPhase(phase: RnpmSplitProgress["phase"]): string {
  switch (phase) {
    case "captcha":
      return "captcha";
    case "search":
      return "cautare";
    case "done":
      return "finalizat";
    case "blocked":
      return "blocat";
    case "skipped":
      return "fara rezultate";
    case "error":
      return "eroare";
    case "nested_start":
      return "split secundar — start";
    case "nested_progress":
      return "split secundar";
    case "nested_done":
      return "split secundar — finalizat";
  }
}

export function describeNestedPhase(phase: RnpmNestedSplitProgress["phase"]): string {
  switch (phase) {
    case "captcha":
      return "captcha";
    case "search":
      return "cautare";
    case "done":
      return "finalizat";
    case "blocked":
      return "blocat";
    case "skipped":
      return "fara rezultate";
    case "error":
      return "eroare";
  }
}

export function formatSplitProgress(p: RnpmSplitProgress): string {
  const tier1 = `Split ${p.index + 1}/${p.total} - ${p.label} (${describeSplitPhase(p.phase)})`;
  const nested = p.nested
    ? ` -> ${p.nested.index}/${p.nested.total} ${p.nested.label} (${describeNestedPhase(p.nested.phase)})`
    : "";
  const message = p.message ? ": " + p.message : "";
  return `${tier1}${nested}${message}`;
}
