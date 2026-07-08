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
  // aria-sort pe th + aria-label cu numele coloanei: screen reader-ul afla si
  // coloana, si directia curenta, nu doar ca "exista o sortare".
  const ariaSort = active ? (sort.sortDir === "asc" ? "ascending" : "descending") : "none";
  const columnName = typeof children === "string" ? children : sortKeyName;
  return (
    <th aria-sort={ariaSort} className={cn("px-3 py-2 font-semibold", className)}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKeyName)}
        title={scopeNote ?? "Sorteaza dupa aceasta coloana"}
        aria-label={`Sorteaza dupa ${columnName}`}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground",
          active && "text-foreground"
        )}
      >
        {children}
        <Icon className={cn("h-3 w-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>
  );
}
