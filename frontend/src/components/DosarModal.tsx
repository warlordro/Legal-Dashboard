import { X, Scale, Users, Calendar, Building2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatDate } from "@/lib/utils";
import type { Dosar } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";

interface DosarModalProps {
  dosar: Dosar;
  onClose: () => void;
}

export function DosarModal({ dosar, onClose }: DosarModalProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: modalul se inchide via butonul X dedicat sau Escape printr-un document-level handler.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="font-mono text-lg font-bold text-primary">{dosar.numar || "Dosar"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{normalizeInstitutie(dosar.institutie)}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
          {/* Info */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoItem icon={Calendar} label="Data Dosar" value={formatDate(dosar.data)} />
            <InfoItem icon={Building2} label="Departament" value={dosar.departament || "-"} />
            <InfoItem icon={Scale} label="Categorie" value={dosar.categorieCaz || "-"} />
          </div>

          {dosar.obiect && (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Obiect Dosar
              </h4>
              <p className="text-sm">{dosar.obiect}</p>
            </div>
          )}

          {/* Parti */}
          {dosar.parti.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Parti ({dosar.parti.length})
              </h4>
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
                {dosar.parti.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {p.calitateParte}
                    </Badge>
                    <span>{p.nume}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sedinte */}
          {dosar.sedinte.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" /> Sedinte ({dosar.sedinte.length})
              </h4>
              <div className="space-y-2">
                {dosar.sedinte.map((s, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">{formatDate(s.data)}</span>
                      {s.ora && <span className="text-xs text-muted-foreground">{s.ora}</span>}
                    </div>
                    {s.complet && <p className="mt-1 text-xs text-muted-foreground">Complet: {s.complet}</p>}
                    {s.solutie && (
                      <div className="mt-1.5 rounded bg-background p-2">
                        <p className="text-xs font-medium">Solutie: {s.solutie}</p>
                        {s.solutieSumar && <p className="mt-0.5 text-xs text-muted-foreground">{s.solutieSumar}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
