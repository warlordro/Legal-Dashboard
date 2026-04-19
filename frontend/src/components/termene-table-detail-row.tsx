import { Scale, Building2, FileText, Users } from "lucide-react";
import { Badge } from "./ui/badge";
import { formatDocumentSedinta } from "@/lib/utils";
import type { Termen } from "@/types";

function HighlightName({ text, search }: { text: string; search?: string }) {
  if (!search || !text) return <>{text}</>;
  const searchWords = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return <>{text}</>;
  const escaped = searchWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = searchWords.some((w) => part.toLowerCase() === w);
        return isMatch ? (
          <span key={i} className="rounded bg-yellow-200 px-0.5 font-semibold text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-200">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}

export interface TermeneExpandedDetailProps {
  termen: Termen;
  searchedName?: string;
}

export function TermeneExpandedDetail({ termen, searchedName }: TermeneExpandedDetailProps) {
  const hasParts = termen.parti && termen.parti.length > 0;
  return (
    <div className="space-y-3 pl-6">
      {/* Info badges */}
      <div className="flex flex-wrap gap-3">
        {termen.categorieCaz && (
          <div className="flex items-center gap-1.5 text-xs">
            <Scale className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Categorie:</span>
            <Badge variant="outline" className="text-[11px]">{termen.categorieCaz}</Badge>
          </div>
        )}
        {termen.stadiuProcesual && (
          <div className="flex items-center gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Stadiu:</span>
            <Badge variant="outline" className="text-[11px]">{termen.stadiuProcesual}</Badge>
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
                <p className="leading-relaxed text-foreground" style={{ fontSize: "14.5px" }}>{termen.solutieSumar}</p>
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
