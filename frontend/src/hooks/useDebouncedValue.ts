import { useCallback, useEffect, useState } from "react";

// Returns `value` after `delayMs` of stillness, plus a `flush` callback that
// publishes a value immediately (cancelling any in-flight debounce). Use `flush`
// in reset handlers so a `setSearchInput("")` doesn't leave the previous query
// visible to consumers for `delayMs` (which would cause a stale fetch).
//
// Page-reset side effects (e.g. `setPage(0)` when the user types in a search
// box) belong inline in the input handler — not in a settle callback — because
// event-handler batching in React 18 is reliable, while batching across the
// setTimeout boundary used here is not.
export function useDebouncedValue<T>(value: T, delayMs = 300): readonly [T, (next: T) => void] {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  const flush = useCallback((next: T) => setDebounced(next), []);
  return [debounced, flush] as const;
}
