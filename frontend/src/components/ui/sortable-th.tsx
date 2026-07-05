import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ClientSort } from "@/hooks/useClientSort";
import { cn } from "@/lib/utils";

// Antet de coloana clickabil pentru useClientSort — sageata arata directia
// activa; coloanele inactive au sageata dubla estompata.
export function SortableTh<K extends string>({
  sort,
  sortKeyName,
  children,
  className,
  scopeNote,
}: {
  sort: ClientSort<K>;
  sortKeyName: K;
  children: React.ReactNode;
  className?: string;
  /** ex. "Sorteaza pagina curenta" pe tabelele paginate pe server */
  scopeNote?: string;
}) {
  const active = sort.sortKey === sortKeyName;
  const Icon = active ? (sort.sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={cn("px-3 py-2 font-semibold", className)}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKeyName)}
        title={scopeNote ?? "Sorteaza dupa aceasta coloana"}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground",
          active && "text-foreground"
        )}
      >
        {children}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </th>
  );
}
