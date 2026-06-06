import { useId, useState, useEffect, useRef } from "react";
import { Search, RotateCcw, Filter, Scale, ChevronsRight, Square } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { InstitutieSelect } from "./InstitutieSelect";
import { ICCJ_SECTII } from "@/lib/iccjSectii";
import type { DosarSource, SearchParams } from "@/types";

const CATEGORII = [
  "Penal",
  "Civil",
  "Contencios administrativ şi fiscal",
  "Litigii de muncă",
  "Faliment",
  "Litigii cu profesioniştii",
  "Altele",
] as const;

const STADII = ["Fond", "Apel", "Recurs", "Contestaţie(NCPP)", "Revizuire - Fond", "Revizuire - Recurs"] as const;

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  onCategoriiChange?: (categorii: string[]) => void;
  onStadiiChange?: (stadii: string[]) => void;
  onInstitutiiChange?: (institutii: string[]) => void;
  onDateChange?: (dataStart?: string, dataStop?: string) => void;
  loading?: boolean;
  showDateRange?: boolean;
  showFilters?: boolean;
  // ICCJ source toggle — Dosare + Termene both support it.
  showSourceToggle?: boolean;
  // ICCJ facet vocabularies, derived from the loaded result set (the static PortalJust
  // Categorie/Stadiu lists do not match ICCJ values). Categorii stays empty until Tier-2
  // detail enrichment populates categorieCaz; the section hides while empty.
  iccjStadiiOptions?: string[];
  iccjCategoriiOptions?: string[];
  showLoadMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onStopLoadMore?: () => void;
  loadMoreMessage?: string;
  loadMoreProgress?: { processed: number; total: number; found: number } | null;
  loadMoreLabel?: string; // "dosare" or "termene"
  loadMoreDone?: boolean;
  loadMoreTotal?: number;
  loadMoreWarnings?: string[];
  defaultParams?: SearchParams;
  onReset?: () => void;
}

export function SearchForm({
  onSearch,
  onCategoriiChange,
  onStadiiChange,
  onInstitutiiChange,
  onDateChange,
  loading,
  showDateRange,
  showFilters = true,
  showSourceToggle = false,
  iccjStadiiOptions = [],
  iccjCategoriiOptions = [],
  showLoadMore,
  loadingMore,
  onLoadMore,
  onStopLoadMore,
  loadMoreMessage,
  loadMoreProgress,
  loadMoreLabel = "dosare",
  loadMoreDone,
  loadMoreTotal,
  loadMoreWarnings,
  defaultParams,
  onReset,
}: SearchFormProps) {
  const [params, setParams] = useState<SearchParams>(defaultParams ?? {});
  const prevDefaultRef = useRef(defaultParams);
  const ids = {
    numarDosar: useId(),
    numeParte: useId(),
    obiectDosar: useId(),
    dataStart: useId(),
    dataStop: useId(),
    sectie: useId(),
  };

  // Sync internal state when defaultParams changes (e.g., history click or tab navigation)
  useEffect(() => {
    if (defaultParams && defaultParams !== prevDefaultRef.current) {
      setParams(defaultParams);
      prevDefaultRef.current = defaultParams;
    }
  }, [defaultParams]);

  const set = (key: keyof SearchParams) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setParams((p) => ({ ...p, [key]: e.target.value }));
  };

  const toggleCategorie = (cat: string) => {
    setParams((p) => {
      const current = p.categorii ?? [];
      const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
      const newCategorii = next.length > 0 ? next : undefined;
      onCategoriiChange?.(newCategorii ?? []);
      return { ...p, categorii: newCategorii };
    });
  };

  const toggleStadiu = (stadiu: string) => {
    setParams((p) => {
      const current = p.stadii ?? [];
      const next = current.includes(stadiu) ? current.filter((s) => s !== stadiu) : [...current, stadiu];
      const newStadii = next.length > 0 ? next : undefined;
      onStadiiChange?.(newStadii ?? []);
      return { ...p, stadii: newStadii };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(params);
  };

  const handleReset = () => {
    setParams({});
    onCategoriiChange?.([]);
    onStadiiChange?.([]);
    onReset?.();
  };

  const source: DosarSource = params.source === "iccj" ? "iccj" : "portaljust";
  const setSource = (next: DosarSource) => {
    setParams((p) => {
      if (next === "iccj") return { ...p, source: "iccj", institutie: undefined };
      const { sectie, ...rest } = p;
      return { ...rest, source: "portaljust" };
    });
  };

  // At least one text field enables the search; ICCJ (Dosare) also allows date-only.
  const hasInput = !!(
    params.numarDosar ||
    params.obiectDosar ||
    params.numeParte ||
    (source === "iccj" && params.dataStart)
  );
  const hasAnyParam = Object.values(params).some(Boolean);
  const selectedCats = params.categorii ?? [];
  const selectedStadii = params.stadii ?? [];
  // ICCJ uses dynamic facet vocabularies from the result set; PortalJust uses the static
  // lists. ICCJ sections render only once their (post-search / post-enrich) options exist.
  const isIccj = source === "iccj";
  const categoriiChips: readonly string[] = isIccj ? iccjCategoriiOptions : CATEGORII;
  const stadiiChips: readonly string[] = isIccj ? iccjStadiiOptions : STADII;
  const showCategoriiSection = showFilters && categoriiChips.length > 0;
  const showStadiiSection = showFilters && stadiiChips.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-primary" />
          Parametri Cautare
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Sursa: PortalJust (fond/apel/recurs) vs ICCJ. Doar pagina Dosare (Termene
              ramane PortalJust). Segmente EGALE (grid 2 col) + selectie clara (fill primary). */}
          {showSourceToggle && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Sursa</span>
              <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border bg-muted p-0.5">
                {(
                  [
                    { key: "portaljust", label: "PortalJust", title: "Portalul instantelor de judecata" },
                    { key: "iccj", label: "ICCJ", title: "Inalta Curte de Casatie si Justitie" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    title={opt.title}
                    aria-pressed={source === opt.key}
                    onClick={() => setSource(opt.key)}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                      source === opt.key
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor={ids.numarDosar} className="text-xs font-medium text-muted-foreground">
                Numar Dosar
              </label>
              <Input
                id={ids.numarDosar}
                placeholder="ex: 1234/2/2024"
                value={params.numarDosar ?? ""}
                onChange={set("numarDosar")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={ids.numeParte} className="text-xs font-medium text-muted-foreground">
                Nume Parte
              </label>
              <Input
                id={ids.numeParte}
                placeholder="ex: Popescu Ion"
                value={params.numeParte ?? ""}
                onChange={set("numeParte")}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={ids.obiectDosar} className="text-xs font-medium text-muted-foreground">
                Obiect Dosar
              </label>
              <Input
                id={ids.obiectDosar}
                placeholder="ex: litigiu proprietate"
                value={params.obiectDosar ?? ""}
                onChange={set("obiectDosar")}
              />
            </div>
          </div>

          {/* Institutie (PortalJust) vs Sectie (ICCJ) */}
          {source === "iccj" ? (
            <div className="space-y-1.5">
              <label htmlFor={ids.sectie} className="text-xs font-medium text-muted-foreground">
                Secție (opțional)
              </label>
              <select
                id={ids.sectie}
                value={params.sectie ?? ""}
                onChange={(e) => setParams((p) => ({ ...p, sectie: e.target.value || undefined }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {ICCJ_SECTII.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: InstitutieSelect e un combobox custom care expune trigger button cu aria-label propriu. */}
              <label className="text-xs font-medium text-muted-foreground">Instituție (opțional)</label>
              <InstitutieSelect
                value={
                  Array.isArray(params.institutie) ? params.institutie : params.institutie ? [params.institutie] : []
                }
                onChange={(val) => {
                  setParams((p) => ({ ...p, institutie: val.length > 0 ? val : undefined }));
                  onInstitutiiChange?.(val);
                }}
              />
            </div>
          )}

          {/* Categorie Caz (filtru client-side): PortalJust = vocabular static; ICCJ =
              categorii distincte din rezultate, disponibile abia dupa enrich. */}
          {showCategoriiSection && (
            <div className="space-y-2">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: label e folosit ca header pentru un grup de toggle-uri, nu pentru un singur control. */}
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                Categorie Caz
                {selectedCats.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {selectedCats.length}
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {categoriiChips.map((cat) => {
                  const active = selectedCats.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategorie(cat)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stadiu Procesual (filtru client-side): PortalJust = vocabular static; ICCJ =
              stadii distincte din rezultate (din lista, fara enrich). */}
          {showStadiiSection && (
            <div className="space-y-2">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: label e folosit ca header pentru un grup de toggle-uri, nu pentru un singur control. */}
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Scale className="h-3.5 w-3.5" />
                Stadiu Procesual
                {selectedStadii.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {selectedStadii.length}
                  </span>
                )}
              </label>
              <div className="flex flex-wrap gap-2">
                {stadiiChips.map((stadiu) => {
                  const active = selectedStadii.includes(stadiu);
                  return (
                    <button
                      key={stadiu}
                      type="button"
                      onClick={() => toggleStadiu(stadiu)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {stadiu}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showDateRange && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={ids.dataStart} className="text-xs font-medium text-muted-foreground">
                  Data Start (optional)
                </label>
                <Input
                  id={ids.dataStart}
                  type="date"
                  value={params.dataStart ?? ""}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setParams((p) => ({ ...p, dataStart: val }));
                    onDateChange?.(val, params.dataStop);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={ids.dataStop} className="text-xs font-medium text-muted-foreground">
                  Data Stop (optional)
                </label>
                <Input
                  id={ids.dataStop}
                  type="date"
                  value={params.dataStop ?? ""}
                  onChange={(e) => {
                    const val = e.target.value || undefined;
                    setParams((p) => ({ ...p, dataStop: val }));
                    onDateChange?.(params.dataStart, val);
                  }}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            * Cel putin un camp de text este necesar (numar dosar, parte sau obiect)
          </p>

          <div className="flex gap-2">
            <Button type="submit" disabled={loading || loadingMore || !hasInput}>
              <Search className="h-4 w-4" />
              {loading ? "Se cauta..." : "Cauta"}
            </Button>
            {(showLoadMore || loadingMore) && !loadingMore && (
              <Button type="button" onClick={onLoadMore} disabled={loading} className="gap-1.5">
                <ChevronsRight className="h-4 w-4" />
                Incarca mai multe
              </Button>
            )}
            {loadingMore && (
              <Button type="button" variant="destructive" onClick={onStopLoadMore} className="gap-1.5">
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            )}
            {hasAnyParam && (
              <Button type="button" variant="outline" onClick={handleReset} disabled={loading || loadingMore}>
                <RotateCcw className="h-4 w-4" /> Reseteaza
              </Button>
            )}
          </div>

          {loadingMore && loadMoreProgress && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">
                Luna {loadMoreProgress.processed} din {loadMoreProgress.total} —{" "}
                {loadMoreProgress.found.toLocaleString("ro-RO")} {loadMoreLabel} noi gasite
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((loadMoreProgress.processed / loadMoreProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {loadMoreMessage && !loadingMore && !loadMoreDone && (
            <p className="text-xs font-medium text-foreground">{loadMoreMessage}</p>
          )}

          {loadMoreDone && !loadingMore && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">
                Cautare extinsa finalizata — {(loadMoreTotal ?? 0).toLocaleString("ro-RO")} {loadMoreLabel} in total
              </p>
              {loadMoreWarnings && loadMoreWarnings.length > 0 && (
                <div className="text-xs text-amber-600 dark:text-amber-400">
                  {loadMoreWarnings.map((w, i) => (
                    <p key={i}>⚠ {w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
