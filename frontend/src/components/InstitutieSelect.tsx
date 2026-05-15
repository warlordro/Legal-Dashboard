import { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, Building2, ChevronDown, Check } from "lucide-react";
import { INSTITUTII, INSTITUTII_GROUPS, getInstitutieLabel } from "@/lib/institutii";

function stripDiacritics(s: string): string {
  // biome-ignore lint/suspicious/noMisleadingCharacterClass: range-ul combina diacriticele dupa normalizare NFD.
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

interface InstitutieSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
}

const getLabel = getInstitutieLabel;

function sortedByLabel(vals: string[]): string[] {
  return [...vals].sort((a, b) => getLabel(a).localeCompare(getLabel(b), "ro"));
}

export function InstitutieSelect({ value, onChange }: InstitutieSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft with value when opening
  useEffect(() => {
    if (open) setDraft(value);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return INSTITUTII;
    const q = stripDiacritics(search.toLowerCase());
    return INSTITUTII.filter(
      (i) =>
        stripDiacritics(i.label.toLowerCase()).includes(q) ||
        stripDiacritics(i.group.toLowerCase()).includes(q) ||
        i.value.toLowerCase().includes(q)
    );
  }, [search]);

  const groupedFiltered = useMemo(() => {
    const map = new Map<string, typeof INSTITUTII>();
    for (const inst of filtered) {
      const arr = map.get(inst.group) ?? [];
      arr.push(inst);
      map.set(inst.group, arr);
    }
    return INSTITUTII_GROUPS.filter((g) => map.has(g)).map((g) => ({
      group: g,
      items: map.get(g) ?? [],
    }));
  }, [filtered]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, draft]);

  const handleToggle = (val: string) => {
    setDraft((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
  };

  const handleClose = () => {
    onChange(sortedByLabel(draft));
    setOpen(false);
    setSearch("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const handleRemoveOne = (e: React.MouseEvent, val: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== val));
  };

  const count = value.length;

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-[36px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          count > 0 ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          {count === 0 ? (
            <span>Toate instituțiile</span>
          ) : count <= 2 ? (
            value.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
              >
                {getLabel(v)}
                <X className="h-3 w-3 cursor-pointer hover:text-primary/70" onClick={(e) => handleRemoveOne(e, v)} />
              </span>
            ))
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                {count} instituții selectate
              </span>
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 pl-2">
          {count > 0 && (
            <span role="button" tabIndex={-1} onClick={handleClear} className="rounded p-0.5 hover:bg-muted">
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[10vh] backdrop-blur-sm"
          onClick={handleClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="institutie-select-title"
            className="mx-4 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-black/5 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Building2 className="h-4 w-4 shrink-0 text-primary" />
              <span id="institutie-select-title" className="text-sm font-semibold">
                Selectează Instituții
              </span>
              {draft.length > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {draft.length}
                </span>
              )}
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraft([])}
                  className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
                >
                  Resetează
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className={`${draft.length > 0 ? "" : "ml-auto"} rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Selected chips */}
            {draft.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5">
                {sortedByLabel(draft).map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {getLabel(v)}
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-primary/70"
                      onClick={() => setDraft((prev) => prev.filter((x) => x !== v))}
                    />
                  </span>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Caută după nume sau oraș..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Results count */}
            <div className="border-b border-border bg-muted/30 px-4 py-1.5">
              <span className="text-[11px] text-muted-foreground">
                {filtered.length} din {INSTITUTII.length} instituții
              </span>
            </div>

            {/* List */}
            <div className="max-h-[50vh] overflow-y-auto scrollbar-thin">
              {groupedFiltered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nicio instituție găsită pentru „{search}"
                </div>
              ) : (
                groupedFiltered.map(({ group, items }) => (
                  <div key={group}>
                    <div className="sticky top-0 z-10 border-b border-border/50 bg-muted/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
                      {group}
                      <span className="ml-1.5 font-normal">({items.length})</span>
                    </div>
                    {items.map((inst) => {
                      const selected = draft.includes(inst.value);
                      return (
                        <button
                          key={inst.value}
                          type="button"
                          onClick={() => handleToggle(inst.value)}
                          className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                            selected ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-accent"
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {selected && <Check className="h-3 w-3" />}
                          </span>
                          <span className="flex-1">{inst.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
