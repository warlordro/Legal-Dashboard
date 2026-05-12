import { useState } from "react";
import { Plus, FileText, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InstitutieSelect } from "@/components/InstitutieSelect";
import { monitoring, formatMonitoringTarget, MonitoringApiError, type MonitoringJob } from "@/lib/api";

const NUMAR_DOSAR_RE = /^\d{1,7}\/\d{1,5}\/\d{4}(?:\/[A-Za-z0-9]+)?$/;

const CADENCE_OPTIONS: { label: string; sec: number }[] = [
  { label: "4h", sec: 14400 },
  { label: "8h", sec: 28800 },
  { label: "12h", sec: 43200 },
  { label: "24h", sec: 86400 },
];
const DEFAULT_CADENCE_SEC = 14400;

interface Props {
  onJobAdded: () => void | Promise<void>;
}

export function MonitoringAddForm({ onJobAdded }: Props) {
  const [formKind, setFormKind] = useState<"dosar" | "nume">("dosar");
  const [numarDosar, setNumarDosar] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [institutie, setInstitutie] = useState<string[]>([]);
  const [cadenceSec, setCadenceSec] = useState(DEFAULT_CADENCE_SEC);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);
    try {
      let job: MonitoringJob;
      let created: boolean;
      if (formKind === "dosar") {
        const trimmed = numarDosar.trim();
        if (!NUMAR_DOSAR_RE.test(trimmed)) {
          setFormError("Format invalid (asteptat: 1234/180/2024)");
          setSubmitting(false);
          return;
        }
        const result = await monitoring.createDosarWithResult({
          numar_dosar: trimmed,
          cadence_sec: cadenceSec,
          notes: notes.trim() || undefined,
        });
        job = result.job;
        created = result.created;
        setNumarDosar("");
      } else {
        // Regula import (2026-05-03): numele de monitorizare sunt mereu UPPERCASE.
        const trimmedName = nameValue.trim().toUpperCase();
        if (trimmedName.length < 2) {
          setFormError("Numele trebuie sa aiba minim 2 caractere");
          setSubmitting(false);
          return;
        }
        const result = await monitoring.createNameWithResult({
          name_normalized: trimmedName,
          institutie: institutie.length > 0 ? institutie : undefined,
          cadence_sec: cadenceSec,
          notes: notes.trim() || undefined,
        });
        job = result.job;
        created = result.created;
        setNameValue("");
        setInstitutie([]);
      }
      // Backend returns 201 on fresh insert, 200 on idempotent replay (target_hash
      // collision). The UX previously showed "Adaugat" for both, which made users
      // think they had double-added the same target.
      setFormSuccess(
        created
          ? `Adaugat: ${formatMonitoringTarget(job)} (id ${job.id})`
          : `Exista deja: ${formatMonitoringTarget(job)} (id ${job.id})`
      );
      setNotes("");
      await onJobAdded();
    } catch (err) {
      if (err instanceof MonitoringApiError) {
        setFormError(`${err.message} (${err.code})`);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError("Eroare necunoscuta.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Adauga in monitorizare
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="flex gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => {
                setFormKind("dosar");
                setFormError(null);
                setFormSuccess(null);
              }}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                formKind === "dosar"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              disabled={submitting}
            >
              <FileText className="h-4 w-4" />
              Nr. Dosar
            </button>
            <button
              type="button"
              onClick={() => {
                setFormKind("nume");
                setFormError(null);
                setFormSuccess(null);
              }}
              className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
                formKind === "nume"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              disabled={submitting}
            >
              <User className="h-4 w-4" />
              Nume
            </button>
          </div>

          {formKind === "dosar" ? (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Numar dosar</label>
                <Input
                  type="text"
                  placeholder="1234/180/2024"
                  value={numarDosar}
                  onChange={(e) => setNumarDosar(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Cadenta</label>
                <Select value={String(cadenceSec)} onValueChange={(v) => setCadenceSec(Number(v))}>
                  <SelectTrigger disabled={submitting}>
                    <SelectValue placeholder="Cadenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.sec} value={String(opt.sec)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Nume subiect</label>
                  <Input
                    type="text"
                    placeholder="ex: POPESCU ION sau SC EXAMPLE SRL"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    disabled={submitting}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Cadenta</label>
                  <Select value={String(cadenceSec)} onValueChange={(v) => setCadenceSec(Number(v))}>
                    <SelectTrigger disabled={submitting}>
                      <SelectValue placeholder="Cadenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {CADENCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.sec} value={String(opt.sec)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Institutii (optional)</label>
                <InstitutieSelect value={institutie} onChange={setInstitutie} />
                <p className="mt-1 text-[11px] text-muted-foreground">Lasa gol pentru cautare in toate institutiile.</p>
              </div>
            </>
          )}

          <div>
            <label className="text-xs font-medium mb-1 block">Note (optional)</label>
            <Input
              type="text"
              placeholder="ex: Client X — apel"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              maxLength={2000}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={submitting || (formKind === "dosar" ? !numarDosar.trim() : !nameValue.trim())}
            >
              {submitting ? "Se adauga..." : "Adauga"}
            </Button>
            {formError && <span className="text-sm text-red-600">{formError}</span>}
            {formSuccess && <span className="text-sm text-green-600">{formSuccess}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
