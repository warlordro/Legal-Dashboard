import { describe, it, expect } from "vitest";
import { describeSplitPhase, describeNestedPhase, formatSplitProgress } from "./rnpmProgressPhase";
import type { RnpmSplitProgress } from "@/types/rnpm";

describe("describeSplitPhase", () => {
  it("traduce nested_progress in romana", () => {
    expect(describeSplitPhase("nested_progress")).toBe("split secundar");
  });

  it("traduce nested_start si nested_done", () => {
    expect(describeSplitPhase("nested_start")).toBe("split secundar — start");
    expect(describeSplitPhase("nested_done")).toBe("split secundar — finalizat");
  });

  it("traduce fazele tier-1 standard", () => {
    expect(describeSplitPhase("captcha")).toBe("captcha");
    expect(describeSplitPhase("search")).toBe("cautare");
    expect(describeSplitPhase("done")).toBe("finalizat");
    expect(describeSplitPhase("blocked")).toBe("blocat");
    expect(describeSplitPhase("skipped")).toBe("fara rezultate");
    expect(describeSplitPhase("error")).toBe("eroare");
  });
});

describe("describeNestedPhase", () => {
  it("traduce fazele tier-2 standard", () => {
    expect(describeNestedPhase("captcha")).toBe("captcha");
    expect(describeNestedPhase("search")).toBe("cautare");
    expect(describeNestedPhase("done")).toBe("finalizat");
    expect(describeNestedPhase("blocked")).toBe("blocat");
    expect(describeNestedPhase("skipped")).toBe("fara rezultate");
    expect(describeNestedPhase("error")).toBe("eroare");
  });
});

describe("formatSplitProgress", () => {
  it("formateaza tier-1 simplu cu index 1-based", () => {
    const p: RnpmSplitProgress = {
      index: 0,
      total: 7,
      label: "aviz initial",
      phase: "search",
    };
    expect(formatSplitProgress(p)).toBe("Split 1/7 - aviz initial (cautare)");
  });

  it("formateaza tier-1 ultimul element corect (n-1 -> n/n)", () => {
    const p: RnpmSplitProgress = {
      index: 6,
      total: 7,
      label: "fara obiect",
      phase: "done",
    };
    expect(formatSplitProgress(p)).toBe("Split 7/7 - fara obiect (finalizat)");
  });

  it("formateaza nested_progress cu sub-progres tier-2", () => {
    const p: RnpmSplitProgress = {
      index: 0,
      total: 7,
      label: "aviz initial",
      phase: "nested_progress",
      nested: {
        index: 3,
        total: 14,
        label: "publicitatea clauzei de inalienabilitate",
        phase: "search",
      },
    };
    expect(formatSplitProgress(p)).toBe(
      "Split 1/7 - aviz initial (split secundar) -> 3/14 publicitatea clauzei de inalienabilitate (cautare)"
    );
  });

  it("apendeaza message daca exista", () => {
    const p: RnpmSplitProgress = {
      index: 1,
      total: 7,
      label: "aviz initial",
      phase: "error",
      message: "timeout SOAP",
    };
    expect(formatSplitProgress(p)).toBe("Split 2/7 - aviz initial (eroare): timeout SOAP");
  });
});
