import { useEffect, useState } from "react";
import { filterRnpmResults, RnpmFilterDisabledError, type RnpmResultsFilterResponse } from "@/lib/rnpmApi";
import { useDebouncedValue } from "./useDebouncedValue";

interface State {
  loading: boolean;
  error: string | null;
  data: RnpmResultsFilterResponse | null;
  disabled: boolean;
}

const INITIAL_STATE: State = { loading: false, error: null, data: null, disabled: false };

export function useRnpmResultsFilter(searchId: number | null, query: string): State {
  const [debounced] = useDebouncedValue(query, 300);
  const [state, setState] = useState<State>(INITIAL_STATE);

  useEffect(() => {
    if (searchId == null) {
      setState(INITIAL_STATE);
      return;
    }
    const trimmed = debounced.trim();
    if (trimmed.length < 2) {
      setState(INITIAL_STATE);
      return;
    }

    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    filterRnpmResults(searchId, trimmed, ctl.signal)
      .then((data) => {
        if (ctl.signal.aborted) return;
        setState({ loading: false, error: null, data, disabled: false });
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof RnpmFilterDisabledError) {
          setState({ loading: false, error: null, data: null, disabled: true });
          return;
        }
        const message = err instanceof Error ? err.message : "Eroare la filtrare";
        setState({ loading: false, error: message, data: null, disabled: false });
      });

    return () => ctl.abort();
  }, [searchId, debounced]);

  return state;
}
