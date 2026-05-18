// Cross-kind types pentru diff engines monitoring (PR-4 dosar_soap, PR-5
// name_soap, etc.). Aici stau doar formele care nu depind de un anumit kind
// de job — orice kind specific (dosar_soap / name_soap / aviz_rnpm) isi
// declara propria uniune de DiffAlertKind si propriul DiffSnapshotPayload
// in modulul lui dedicat din `./diff/<kind>.ts`.

export type DiffAlertSeverity = "info" | "warning" | "critical";

// Plafon dur pentru `monitoring_snapshots.payload_json` (canonicalJson UTF-8
// bytes). 3 MiB acomodeaza joburile name_soap pe corporate names mari cu
// sute de dosare. Peste pragul asta e fie un dosar patologic, fie un raspuns
// neasteptat de la upstream; runner-ul emite SNAPSHOT_OVERSIZE si refuza
// scrierea, iar repo-ul pastreaza acelasi cap ca defense-in-depth.
export const SNAPSHOT_PAYLOAD_MAX_BYTES = 3 << 20;

// Forma generica pe care orice diff engine o emite pentru fiecare alerta
// candidata. `dedupKey` trebuie sa fie stabila intre re-run-uri pe acelasi
// input (consumatorul scrie cu INSERT ... ON CONFLICT(job_id, dedup_key)
// DO NOTHING). Parametrizarea pe `K` permite fiecarui kind sa-si restranga
// uniunea propriei alert kinds fara sa rescrie structura.
export interface DiffAlertEmit<K extends string> {
  kind: K;
  severity: DiffAlertSeverity;
  title: string;
  detail: Record<string, unknown>;
  dedupKey: string;
}
