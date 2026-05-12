import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function getPageNumbers(currentPage: number, totalPages: number): (number | "...")[] {
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  const current = currentPage + 1;
  pages.push(1);
  if (current > 3) pages.push("...");
  for (let i = Math.max(2, current - 1); i <= Math.min(totalPages - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < totalPages - 2) pages.push("...");
  pages.push(totalPages);
  return pages;
}

const DEFAULT_PAGE_SIZES = [10, 15, 25, 50, 100];

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizes?: number[];
  // Cursor-pagination extras (RnpmResultsTable): extra "Incarca mai multe" button.
  hasMore?: boolean;
  loadMoreLoading?: boolean;
  onNeedMore?: () => void;
  loadedCount?: number;
  totalResults?: number;
  // When true, disables all controls and shows a spinner (server-pagination fetch).
  disabled?: boolean;
}

export function TablePagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = DEFAULT_PAGE_SIZES,
  hasMore,
  loadMoreLoading,
  onNeedMore,
  loadedCount,
  totalResults,
  disabled,
}: TablePaginationProps) {
  return (
    <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(0)} disabled={page === 0 || disabled}>
          «
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0 || disabled}
        >
          ‹ Inapoi
        </Button>
        <div className="flex items-center gap-1">
          {getPageNumbers(page, totalPages).map((p, i) =>
            p === "..." ? (
              <span key={`dots-${i}`} className="px-1 text-sm text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page + 1 ? "default" : "outline"}
                size="sm"
                className="min-w-[32px]"
                onClick={() => onPageChange((p as number) - 1)}
                disabled={disabled}
              >
                {p}
              </Button>
            )
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page === totalPages - 1 || disabled}
        >
          Inainte ›
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(totalPages - 1)}
          disabled={page === totalPages - 1 || disabled}
        >
          »
        </Button>
        {hasMore && onNeedMore && (
          <Button variant="outline" size="sm" disabled={loadMoreLoading} onClick={onNeedMore} className="ml-2">
            {loadMoreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Incarca mai multe ({loadedCount} din {totalResults})
          </Button>
        )}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-muted-foreground">Pagina</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={page + 1}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10);
              if (val >= 1 && val <= totalPages) onPageChange(val - 1);
            }}
            className="w-14 rounded border border-border bg-background px-2 py-1 text-center text-sm"
          />
        </div>
        {disabled && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1" />}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          Pagina {page + 1} din {totalPages}
        </span>
        <span className="text-xs text-muted-foreground">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Rezultate pe pagina:</span>
          {pageSizes.map((size) => (
            <button
              key={size}
              onClick={() => onPageSizeChange(size)}
              disabled={disabled}
              className={`min-w-[32px] rounded px-2 py-0.5 text-xs border ${pageSize === size ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background text-muted-foreground hover:bg-muted"} disabled:opacity-50`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
