import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/hooks/useClientSort";

// v2.42.0 (6.8): header de coloana sortabil, pereche cu useClientSort.
// `scopeNote` = title pe tabelele paginate pe SERVER ("Sorteaza pagina
// curenta") — sortarea client-side vede doar pagina incarcata.

export interface SortableThProps {
  sort: { sortKey: string | null; sortDir: SortDir | null; toggle: (key: string) => void };
  sortKeyName: string;
  children: ReactNode;
  scopeNote?: string;
  className?: string;
}

export function SortableTh({ sort, sortKeyName, children, scopeNote, className }: SortableThProps) {
  const active = sort.sortKey === sortKeyName;
  const Icon = active ? (sort.sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn("px-3 py-2 font-semibold", className)}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKeyName)}
        title={scopeNote}
        aria-label="Sorteaza dupa coloana"
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
      >
        {children}
        <Icon className={cn("h-3 w-3 shrink-0", active ? "text-foreground" : "text-muted-foreground/50")} />
      </button>
    </th>
  );
}
