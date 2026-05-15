import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, ExternalLink, ChevronDown, ChevronUp, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { formatDate } from "@/lib/utils";
import type { Termen } from "@/types";
import { normalizeInstitutie } from "@/lib/institutii";

// PortalJust SharePoint indexer nu retine sufixul de dosar asociat (/a, /a1, /a2 ...).
function getPortalJustUrl(numar: string): string {
  const parent = numar.replace(/\/a\d*$/i, "");
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(parent)}`;
}

interface CalendarViewProps {
  termene: Termen[];
}

const MONTHS_RO = [
  "Ianuarie",
  "Februarie",
  "Martie",
  "Aprilie",
  "Mai",
  "Iunie",
  "Iulie",
  "August",
  "Septembrie",
  "Octombrie",
  "Noiembrie",
  "Decembrie",
];
const DAYS_RO = ["Lu", "Ma", "Mi", "Jo", "Vi", "Sa", "Du"];

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function CalendarView({ termene }: CalendarViewProps) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const toggleCard = (index: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else setCurrentMonth((m) => m - 1);
    setSelectedDay(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else setCurrentMonth((m) => m + 1);
    setSelectedDay(null);
  };

  // Group termene by date
  const termeneByDay = termene.reduce<Record<string, Termen[]>>((acc, t) => {
    const d = parseDate(t.data);
    if (!d) return acc;
    if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) return acc;
    const key = d.getDate().toString();
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  // Calendar grid
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = lastDay.getDate();

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedTermene = selectedDay ? (termeneByDay[selectedDay.toString()] ?? []) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        {/* Calendar header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Button variant="ghost" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold">
            {MONTHS_RO[currentMonth]} {currentYear}
          </h2>
          <Button variant="ghost" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS_RO.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isToday =
              day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
            const hasTermene = day !== null && !!termeneByDay[day.toString()];
            const count = day !== null ? (termeneByDay[day.toString()]?.length ?? 0) : 0;
            const isSelected = day === selectedDay;

            return (
              <div
                key={i}
                onClick={() => day && setSelectedDay(isSelected ? null : day)}
                className={`relative min-h-[60px] border-b border-r border-border p-1.5 transition-colors
                  ${!day ? "bg-muted/20" : "cursor-pointer hover:bg-muted/40"}
                  ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}
                `}
              >
                {day && (
                  <>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium
                        ${isToday ? "bg-primary text-primary-foreground" : ""}
                        ${isSelected && !isToday ? "font-bold text-primary" : ""}
                      `}
                    >
                      {day}
                    </span>
                    {hasTermene && (
                      <div className="mt-1 flex flex-wrap gap-0.5">
                        {count <= 3 ? (
                          Array.from({ length: count }).map((_, j) => (
                            <div key={j} className="h-1.5 w-1.5 rounded-full bg-primary" />
                          ))
                        ) : (
                          <span className="text-[10px] font-semibold text-primary">{count} term.</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Detail panel */}
      <Card>
        <div className="border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-primary" />
            {selectedDay ? `${selectedDay} ${MONTHS_RO[currentMonth]} ${currentYear}` : "Selectati o zi"}
          </h3>
        </div>
        <div className="max-h-[400px] overflow-y-auto scrollbar-thin p-3">
          {!selectedDay && (
            <p className="py-8 text-center text-xs text-muted-foreground">Click pe o zi cu termene pentru detalii</p>
          )}
          {selectedDay && selectedTermene.length === 0 && (
            <p className="py-8 text-center text-[13.5px] text-muted-foreground">Niciun termen in aceasta zi</p>
          )}
          <div className="space-y-2">
            {selectedTermene.map((t, i) => {
              const isExpanded = expandedCards.has(i);
              const hasDetails = t.solutie || t.solutieSumar || (t.parti && t.parti.length > 0);
              return (
                <div
                  key={i}
                  className={`rounded-lg border border-border bg-muted/30 text-[13.5px] transition-colors ${hasDetails ? "cursor-pointer hover:bg-muted/50" : ""}`}
                >
                  <div
                    className="flex items-center justify-between gap-2 p-3"
                    onClick={() => hasDetails && toggleCard(i)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <a
                          href={getPortalJustUrl(t.numarDosar)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-mono font-semibold text-primary hover:text-primary/80 hover:underline"
                        >
                          {t.numarDosar}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                        {t.ora && <span className="text-muted-foreground">{t.ora}</span>}
                      </div>
                      <p className="mt-0.5 text-muted-foreground truncate">{normalizeInstitutie(t.institutie)}</p>
                      {t.complet && <p className="mt-0.5">Complet: {t.complet}</p>}
                      {t.solutie && !isExpanded && (
                        <div className="mt-1">
                          <Badge variant="secondary" className="text-[11.5px]">
                            {t.solutie}
                          </Badge>
                        </div>
                      )}
                    </div>
                    {hasDetails && (
                      <span className="shrink-0 text-muted-foreground">
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </span>
                    )}
                  </div>

                  {isExpanded && hasDetails && (
                    <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
                      {/* Solutie */}
                      {(t.solutie || t.solutieSumar) && (
                        <div>
                          {t.solutie && <p className="text-[13.5px] font-semibold text-foreground">{t.solutie}</p>}
                          {t.solutieSumar && (
                            <div className="mt-1 rounded bg-background p-2">
                              <p className="leading-relaxed text-foreground" style={{ fontSize: "14.5px" }}>
                                {t.solutieSumar}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Parti */}
                      {t.parti && t.parti.length > 0 && (
                        <div>
                          <h4 className="mb-1 flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <Users className="h-3 w-3" /> Parti ({t.parti.length})
                          </h4>
                          <div className="space-y-0.5">
                            {t.parti.map((p, j) => (
                              <div key={j} className="flex items-center gap-1 text-[12.5px]">
                                <Badge variant="outline" className="shrink-0 text-[10.5px] px-1 py-0">
                                  {p.calitateParte}
                                </Badge>
                                <span className="truncate" title={p.nume}>
                                  {p.nume}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Legenda</p>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Termen programat</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {today.getDate()}
              </div>
              <span>Ziua curenta</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
