import { useCallback, useState } from "react";
import { monitoring, MonitoringApiError } from "@/lib/api";
import { parseSqliteUtc } from "@/lib/utils";

export type MonitorRowStatus = "pending" | "added" | "exists" | string;

export interface UseMonitorRowStateResult {
  monitorState: Record<string, MonitorRowStatus>;
  handleMonitor: (numar: string) => Promise<void>;
}

// Per-dosar monitor feedback: pending = request in flight, "added" / "exists" /
// arbitrary error message. State stays local to the row so feedback is immediate;
// the global Monitorizare page is the source of truth and is refreshed on visit.
export function useMonitorRowState(): UseMonitorRowStateResult {
  const [monitorState, setMonitorState] = useState<Record<string, MonitorRowStatus>>({});

  const handleMonitor = useCallback(
    async (numar: string) => {
      if (!numar || monitorState[numar] === "pending") return;
      setMonitorState((prev) => ({ ...prev, [numar]: "pending" }));
      try {
        // client_request_id makes a double-click idempotent: backend returns the
        // existing row instead of erroring or creating a duplicate.
        const reqId = `dosar-${numar}-${Date.now()}`;
        const job = await monitoring.createDosar({
          numar_dosar: numar,
          client_request_id: reqId,
        });
        // The backend returns 201 on fresh insert and 200 on target_hash collision;
        // both are exposed as the same shape here, so we infer "exists" when the
        // job's created_at predates the request by more than a few seconds.
        const wasJustCreated = Date.now() - parseSqliteUtc(job.created_at).getTime() < 5000;
        setMonitorState((prev) => ({
          ...prev,
          [numar]: wasJustCreated ? "added" : "exists",
        }));
      } catch (err) {
        const msg = err instanceof MonitoringApiError ? err.message : err instanceof Error ? err.message : "Eroare";
        setMonitorState((prev) => ({ ...prev, [numar]: msg }));
      }
    },
    [monitorState]
  );

  return { monitorState, handleMonitor };
}
