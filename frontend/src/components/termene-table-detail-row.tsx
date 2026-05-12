import { Scale, Building2, FileText, Users, Activity } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { HighlightName } from "@/components/dosare-table-highlight";
import { formatDocumentSedinta } from "@/lib/utils";
import type { Termen } from "@/types";

export interface TermeneExpandedDetailProps {
  termen: Termen;
  searchedName?: string;
  monitorState?: "pending" | "added" | "exists" | string;
  onMonitor?: (numar: string) => void;
}

export function TermeneExpandedDetail({ termen, searchedName, monitorState, onMonitor }: TermeneExpandedDetailProps) {
  const hasParts = termen.parti && termen.parti.length > 0;
  const isPending = monitorState === "pending";
  const isAdded = monitorState === "added";
  const isExists = monitorState === "exists";
  const errorMsg = monitorState && !["pending", "added", "exists"].includes(monitorState) ? monitorState : null;
  return (
    <div className="space-y-3 pl-6">
      {/* Action bar — Monitorizeaza schimbari pe acest dosar */}
      {termen.numarDosar && onMonitor && (
        <div className="flex items-center gap-2">
          <Button
            variant={isAdded || isExists ? "secondary" : "outline"}
            size="sm"
            disabled={isPending || isAdded || isExists}
            onClick={(e) => {
              e.stopPropagation();
              onMonitor(termen.numarDosar);
            }}
          >
            <Activity className="h-4 w-4" />
            {isPending
              ? "Se adauga..."
              : isAdded
                ? "Adaugat la monitorizare"
                : isExists
                  ? "Deja monitorizat"
                  : "Monitorizeaza schimbari"}
          </Button>
          {errorMsg && <span className="text-xs text-red-600">{errorMsg}</span>}
        </div>
      )}

      {/* Info badges */}
      <div className="flex flex-wrap gap-3">
        {termen.categorieCaz && (
          <div className="flex items-center gap-1.5 text-xs">
            <Scale className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Categorie:</span>
            <Badge variant="outline" className="text-[11px]">
              {termen.categorieCaz}
            </Badge>
          </div>
        )}
        {termen.stadiuProcesual && (
          <div className="flex items-center gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Stadiu:</span>
            <Badge variant="outline" className="text-[11px]">
              {termen.stadiuProcesual}
            </Badge>
          </div>
        )}
        {termen.obiect && (
          <div className="flex items-center gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Obiect:</span>
            <span className="text-xs font-medium">{termen.obiect}</span>
          </div>
        )}
      </div>

      {/* Solutie completa */}
      {(termen.solutie || termen.solutieSumar) && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Scale className="h-3.5 w-3.5" /> Solutie
          </h4>
          <div className="rounded-lg border border-border bg-background p-3">
            {termen.solutie && (
              <p className="mb-2 text-sm font-medium text-foreground">{formatDocumentSedinta(termen.solutie!)}</p>
            )}
            {termen.solutieSumar && (
              <div className="rounded bg-muted/30 p-2">
                <p className="leading-relaxed text-foreground" style={{ fontSize: "14.5px" }}>
                  {termen.solutieSumar}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Parti */}
      {hasParts && (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Parti ({termen.parti!.length})
          </h4>
          <div className="grid gap-1 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
            {termen.parti!.map((p, j) => (
              <div key={j} className="flex items-center gap-1.5 text-xs">
                <Badge variant="outline" className="shrink-0 text-xs">
                  {p.calitateParte}
                </Badge>
                <span className="truncate" title={p.nume}>
                  <HighlightName text={p.nume} search={searchedName} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
