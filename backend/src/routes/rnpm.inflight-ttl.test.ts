import { describe, it, expect, vi, afterEach } from "vitest";
import { setInflight, clearInflight, hasInflight, INFLIGHT_TTL_SEARCH_MS } from "./rnpm.ts";

// Helperele opereaza pe Map-uri module-level. Cheile sunt namespaced cu
// `ttl-test:` ca sa nu intre in conflict cu rute reale.

afterEach(() => {
  vi.useRealTimers();
});

describe("setInflight / clearInflight — TTL safety net", () => {
  it("auto-evicts the key after TTL elapses (finally never ran)", () => {
    vi.useFakeTimers();
    const key = "ttl-test:auto-evict";
    setInflight(key, 100, Promise.resolve());
    expect(hasInflight(key)).toBe(true);

    vi.advanceTimersByTime(50);
    expect(hasInflight(key)).toBe(true);

    vi.advanceTimersByTime(60); // total 110ms > 100ms TTL
    expect(hasInflight(key)).toBe(false);
  });

  it("clearInflight removes key and cancels the pending TTL timer", () => {
    vi.useFakeTimers();
    const key = "ttl-test:clear-cancels";
    setInflight(key, INFLIGHT_TTL_SEARCH_MS, Promise.resolve());
    expect(hasInflight(key)).toBe(true);

    clearInflight(key);
    expect(hasInflight(key)).toBe(false);

    // Daca timer-ul nu ar fi fost cleared, ar fire la TTL si ar incerca
    // delete pe o cheie inexistenta — no-op pe Map, dar ar leak-ui un
    // handle in event loop. vi.advanceTimersByTime nu raises orphans, dar
    // un re-set DUPA clear nu trebuie sa fie victimat de timer-ul vechi.
    setInflight(key, 200, Promise.resolve());
    vi.advanceTimersByTime(150); // primul timer (anulat) ar fi expirat aici
    expect(hasInflight(key)).toBe(true);

    clearInflight(key);
    expect(() => clearInflight(key)).not.toThrow(); // idempotent
  });

  it("re-setting same key clears the old timer (no double-eviction)", () => {
    vi.useFakeTimers();
    const key = "ttl-test:re-set";
    setInflight(key, 100, Promise.resolve());
    vi.advanceTimersByTime(50);

    // Re-set inainte de TTL — fara clearTimeout pe timer-ul vechi, el ar fire
    // la t=100 si ar sterge cheia care a fost re-set-uita intre timp,
    // corupand dedup-ul (un retry legitim de la client ar trece in fereastra).
    setInflight(key, 200, Promise.resolve());
    vi.advanceTimersByTime(60); // total 110ms — primul timer ar fi expirat
    expect(hasInflight(key)).toBe(true);

    // Al doilea timer trebuie sa fire la t=50+200=250ms.
    vi.advanceTimersByTime(150); // total 260ms > 250ms
    expect(hasInflight(key)).toBe(false);
  });
});
