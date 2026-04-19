import { Link } from "react-router-dom";
import { FileSearch, ArrowRight, FolderOpen, BarChart3, Scale, FileLock2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { RnpmSearchHistoryEntry, RnpmSearchType } from "@/types/rnpm";

const RNPM_TYPE_LABEL: Record<RnpmSearchType, string> = {
  ipoteci: "Ipoteci",
  fiducii: "Fiducii",
  specifice: "Operatiuni specifice",
  creante: "Creante",
  obligatiuni: "Obligatiuni",
};

function stripRnpmLabelType(label: string, type: RnpmSearchType): string {
  const prefix = `${type} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

function formatRnpmTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface LastDosareCardProps {
  count: number;
  categoriesCount: number;
  institutiiCount: number;
  searchedName?: string;
  onOpen: () => void;
}

export function LastDosareCard({ count, categoriesCount, institutiiCount, searchedName, onOpen }: LastDosareCardProps) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Ultima Cautare
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FolderOpen className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Dosare Gasite</p>
              <p className="text-lg font-bold">{count}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <BarChart3 className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Categorii</p>
              <p className="text-lg font-bold">{categoriesCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
              <Scale className="h-4 w-4 text-teal-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Institutii</p>
              <p className="text-lg font-bold">{institutiiCount}</p>
            </div>
          </div>
        </Card>
        {searchedName && (
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                <FileSearch className="h-4 w-4 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Parte Cautata</p>
                <p className="truncate text-sm font-bold">{searchedName}</p>
              </div>
            </div>
          </Card>
        )}
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
        >
          Vezi dosarele <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function LastRnpmCard({ entry }: { entry: RnpmSearchHistoryEntry }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Ultima Cautare RNPM
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
              <FileLock2 className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avize Gasite</p>
              <p className="text-lg font-bold">{entry.resultCount}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <BarChart3 className="h-4 w-4 text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Tip</p>
              <p className="truncate text-sm font-bold">{RNPM_TYPE_LABEL[entry.type]}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
              <FileSearch className="h-4 w-4 text-purple-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Cautat dupa</p>
              <p className="truncate text-sm font-bold">{stripRnpmLabelType(entry.label, entry.type) || "—"}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
              <Clock className="h-4 w-4 text-teal-500" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Data</p>
              <p className="truncate text-sm font-bold">{formatRnpmTimestamp(entry.timestamp)}</p>
            </div>
          </div>
        </Card>
      </div>
      <div className="mt-3">
        <Link
          to="/rnpm"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
        >
          Vezi avizele <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
