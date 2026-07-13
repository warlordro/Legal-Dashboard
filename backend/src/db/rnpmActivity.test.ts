// v2.43.0 (rnpm-split): gardul in-proces search vs restore per owner.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRnpmActivityForTests,
  beginRnpmRestore,
  beginRnpmSearch,
  endRnpmRestore,
  endRnpmSearch,
  hasActiveRnpmSearch,
  isRnpmRestoreInProgress,
  RnpmRestoreInProgressError,
  RnpmSearchActiveError,
} from "./rnpmActivity.ts";

afterEach(() => {
  __resetRnpmActivityForTests();
  vi.restoreAllMocks();
});

describe("rnpmActivity", () => {
  it("begin/end simetric pe search", () => {
    expect(hasActiveRnpmSearch("u1")).toBe(false);
    beginRnpmSearch("u1");
    expect(hasActiveRnpmSearch("u1")).toBe(true);
    endRnpmSearch("u1");
    expect(hasActiveRnpmSearch("u1")).toBe(false);
  });

  it("beginRnpmRestore arunca RnpmSearchActiveError daca exista search activ", () => {
    beginRnpmSearch("u1");
    expect(() => beginRnpmRestore("u1")).toThrow(RnpmSearchActiveError);
    endRnpmSearch("u1");
    expect(() => beginRnpmRestore("u1")).not.toThrow();
    expect(isRnpmRestoreInProgress("u1")).toBe(true);
    endRnpmRestore("u1");
    expect(isRnpmRestoreInProgress("u1")).toBe(false);
  });

  it("beginRnpmSearch arunca RnpmRestoreInProgressError daca restore activ", () => {
    beginRnpmRestore("u1");
    expect(() => beginRnpmSearch("u1")).toThrow(RnpmRestoreInProgressError);
    endRnpmRestore("u1");
    expect(() => beginRnpmSearch("u1")).not.toThrow();
  });

  it("ownerii diferiti nu se blocheaza reciproc", () => {
    beginRnpmSearch("u1");
    beginRnpmRestore("u2");
    expect(() => beginRnpmRestore("u2")).not.toThrow(); // search-ul lui u1 nu conteaza
    expect(() => beginRnpmSearch("u1")).not.toThrow(); // restore-ul lui u2 nu conteaza
    expect(hasActiveRnpmSearch("u2")).toBe(false);
    expect(isRnpmRestoreInProgress("u1")).toBe(false);
  });

  it("dublu-begin + un end => search inca activ", () => {
    beginRnpmSearch("u1");
    beginRnpmSearch("u1");
    endRnpmSearch("u1");
    expect(hasActiveRnpmSearch("u1")).toBe(true);
    endRnpmSearch("u1");
    expect(hasActiveRnpmSearch("u1")).toBe(false);
  });

  it("dublu-end => warn, nu throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    beginRnpmSearch("u1");
    endRnpmSearch("u1");
    expect(() => endRnpmSearch("u1")).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(hasActiveRnpmSearch("u1")).toBe(false);
  });

  it("erorile au cod masina pentru envelope", () => {
    expect(new RnpmSearchActiveError().code).toBe("SEARCH_ACTIVE");
    expect(new RnpmRestoreInProgressError().code).toBe("RESTORE_IN_PROGRESS");
  });
});
