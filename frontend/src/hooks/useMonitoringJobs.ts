// useMonitoringJobs — data-fetch + paging/filter state for the Monitorizare
// page. Pulled out of pages/Monitorizare.tsx (MIN-VIABLE seam) so the page
// can focus on UI orchestration (selection, modals, mutations) while the
// hook owns:
//   - server-side paging (page / pageSize, 0-indexed UI ↔ 1-indexed API)
//   - kind filter ("all" / dosar_soap / name_soap)
//   - debounced free-text search (300ms) with synchronous flush for resets
//   - in-flight request abort on filter change
//   - empty-page-after-delete step-back recovery
//   - explicit `refresh()` for post-mutation reloads
//
// What stays in the page (intentional):
//   - selection (selectedIds Set), bulk-delete UX
//   - confirm dialogs, modals, formatting, link generation
//   - exporting, export progress state
// Those are presentation concerns — extracting them would require dragging
// the confirm/modal infrastructure into the hook layer, which is exactly the
// god-component / hook-explosion trade we are trying NOT to make.

import { useCallback, useEffect, useRef, useState } from "react";
import { monitoring, type MonitoringJob } from "@/lib/api";
import type { JobKindFilter } from "@/components/monitoring/JobKindTabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

export interface UseMonitoringJobsResult {
  jobs: MonitoringJob[];
  total: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  kindFilter: JobKindFilter;
  searchInput: string;
  debouncedQuery: string;
  setPage: (next: number | ((prev: number) => number)) => void;
  setPageSize: (next: number) => void;
  setKindFilter: (next: JobKindFilter) => void;
  setSearchInput: (next: string) => void;
  flushQuery: (next: string) => void;
  refresh: () => Promise<void>;
  setError: (next: string | null) => void;
  // Escape hatch for optimistic updates from the page layer (e.g. instant
  // cadence patch). The page is expected to follow up with `refresh()` so
  // server state remains the source of truth.
  setJobs: (next: MonitoringJob[] | ((prev: MonitoringJob[]) => MonitoringJob[])) => void;
}

export function useMonitoringJobs(): UseMonitoringJobsResult {
  const [jobs, setJobs] = useState<MonitoringJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v2.10.3 paginare server-side. Backend cap: 100 / pagina (JobListQuerySchema).
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  // v2.10.4 filtru kind ("all" = fara filtru) + search free-text.
  const [kindFilter, setKindFilter] = useState<JobKindFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  // page reset is wired into searchInput's onChange (event-handler batching),
  // not into the debounce settle callback — the setTimeout boundary in
  // useDebouncedValue doesn't reliably batch setDebounced + setPage in React
  // 18, which produced an extra fetch with the stale page. `flushQuery("")` on
  // Reset bypasses the 300ms wait so the next fetch sees the cleared `q`.
  const [debouncedQuery, flushQuery] = useDebouncedValue(searchInput.trim(), 300);

  // Abort the in-flight list() when filters change before the previous response
  // lands, otherwise an out-of-order resolution overwrites fresh state with
  // stale rows (race: type fast in q, server lags wide query, narrow lands
  // first, wide overwrites). Mirror of Alerts.tsx.
  const listAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    listAbortRef.current?.abort();
    const ctrl = new AbortController();
    listAbortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      // Server is 1-indexed; UI keeps 0-indexed pages for TablePagination parity.
      const result = await monitoring.list({
        page: page + 1,
        pageSize,
        kind: kindFilter === "all" ? undefined : kindFilter,
        q: debouncedQuery || undefined,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setJobs(result.rows);
      setTotal(result.total);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (e instanceof Error && e.name === "AbortError") return;
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Eroare la incarcarea jobs.");
    } finally {
      if (listAbortRef.current === ctrl) {
        setLoading(false);
        listAbortRef.current = null;
      }
    }
  }, [page, pageSize, kindFilter, debouncedQuery]);

  useEffect(() => {
    refresh();
    return () => {
      listAbortRef.current?.abort();
      listAbortRef.current = null;
    };
  }, [refresh]);

  // If a delete leaves the current page empty (e.g. last item on last page),
  // step back so the user doesn't land on an empty grid.
  useEffect(() => {
    if (loading) return;
    if (jobs.length === 0 && total > 0 && page > 0) {
      setPage((p) => Math.max(0, p - 1));
    }
  }, [jobs.length, total, page, loading]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return {
    jobs,
    total,
    totalPages,
    loading,
    error,
    page,
    pageSize,
    kindFilter,
    searchInput,
    debouncedQuery,
    setPage,
    setPageSize,
    setKindFilter,
    setSearchInput,
    flushQuery,
    refresh,
    setError,
    setJobs,
  };
}
