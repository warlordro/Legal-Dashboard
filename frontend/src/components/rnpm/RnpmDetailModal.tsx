import { useEffect, useRef, useState } from "react";
import { X, Loader2, Users, User, Package, FileText, History as HistoryIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRnpmAvizStatus } from "@/lib/rnpmAvizStatus";
import { rnpmGetAvizDetail } from "@/lib/rnpmApi";
import type { RnpmAvizFull, RnpmParty, RnpmBun, RnpmBunPartyRef } from "@/types/rnpm";

type Tab = "general" | "creditori" | "debitori" | "bunuri" | "istoric";

export interface RnpmDetailModalProps {
  avizId: number | null;
  onClose: () => void;
}

export function RnpmDetailModal({ avizId, onClose }: RnpmDetailModalProps) {
  const [identificator, setIdentificator] = useState<string | null>(null);
  useEffect(() => {
    if (avizId != null) setIdentificator(null);
  }, [avizId]);
  if (avizId == null) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className="flex w-full max-w-4xl max-h-[90vh] flex-col rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
            Detalii Aviz
            {identificator && <span className="text-xs font-semibold text-foreground">{identificator}</span>}
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <RnpmAvizDetailContent avizId={avizId} onIdentificatorLoaded={setIdentificator} />
        </div>
      </div>
    </div>
  );
}

export function RnpmAvizDetailContent({
  avizId,
  onIdentificatorLoaded,
  filterTokens: _filterTokens = [],
}: { avizId: number; onIdentificatorLoaded?: (id: string) => void; filterTokens?: string[] }) {
  const [data, setData] = useState<RnpmAvizFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const tabsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setTab("general");
    rnpmGetAvizDetail(avizId)
      .then((d) => {
        setData(d);
        onIdentificatorLoaded?.(d.aviz.identificator);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Eroare"))
      .finally(() => setLoading(false));
  }, [avizId, onIdentificatorLoaded]);

  // Avizele specifice au "parti" (bucket unic cu calitate+altaCalitate), nu creditori/debitori —
  // le mapam pe campul debitori in DB si afisam un singur tab "Parti".
  const isSpecifice = data?.aviz.search_type === "specifice";
  const tabs: { id: Tab; label: string; icon: typeof Users; count?: number }[] = isSpecifice
    ? [
        { id: "general", label: "General", icon: FileText },
        { id: "debitori", label: "Parti", icon: Users, count: data?.debitori.length },
        { id: "bunuri", label: "Bunuri", icon: Package, count: data?.bunuri.length },
        { id: "istoric", label: "Istoric", icon: HistoryIcon, count: data?.istoric.length },
      ]
    : [
        { id: "general", label: "General", icon: FileText },
        { id: "creditori", label: "Creditori", icon: Users, count: data?.creditori.length },
        { id: "debitori", label: "Debitori", icon: User, count: data?.debitori.length },
        { id: "bunuri", label: "Bunuri", icon: Package, count: data?.bunuri.length },
        { id: "istoric", label: "Istoric", icon: HistoryIcon, count: data?.istoric.length },
      ];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) return <div className="p-4 text-center text-sm text-red-500">{error}</div>;
  if (!data) return null;

  return (
    <div>
      <div ref={tabsRef} className="flex flex-wrap gap-1 border-b border-border px-2 pt-2 scroll-mt-20">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            type="button"
            key={id}
            onClick={() => {
              setTab(id);
              requestAnimationFrame(() => {
                const tabs = tabsRef.current;
                if (!tabs) return;
                const tabsRect = tabs.getBoundingClientRect();
                window.scrollBy({ top: tabsRect.top - 10, behavior: "smooth" });
              });
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors",
              tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count != null && count > 0 && (
              <span className="rounded-full bg-background/30 px-1.5 text-[10px]">{count}</span>
            )}
          </button>
        ))}
      </div>
      <div ref={contentRef} className="p-4">
        {tab === "general" && <GeneralTab data={data} />}
        {tab === "creditori" && <PartyList parties={data.creditori} emptyMsg="Fara creditori" />}
        {tab === "debitori" && (
          <PartyList parties={data.debitori} emptyMsg={isSpecifice ? "Fara parti" : "Fara debitori"} showCalitate />
        )}
        {tab === "bunuri" && <BunuriList bunuri={data.bunuri} detaliiComune={data.aviz.detalii_comune} />}
        {tab === "istoric" && <IstoricList istoric={data.istoric} />}
      </div>
    </div>
  );
}

function GeneralTab({ data }: { data: RnpmAvizFull }) {
  const a = data.aviz;
  const rows: [string, string | null][] = [
    ["Tip", a.tip],
    ["Destinatie", a.destinatie],
    ["Tip act", a.tip_act],
    ["Numar act", a.numar_act],
    ["Data inregistrare", a.data_inreg],
    ["Data expirare", a.data_expirare],
    ["Stadiu", formatRnpmAvizStatus(a.activ === 1 ? true : a.activ === 0 ? false : null)],
    ["Utilizator autorizat", a.utilizator_autorizat],
    ["Inscriere initiala", a.inscriere_initiala_id],
    ["Inscriere modificata", a.inscriere_modificata_id],
    ["Alte mentiuni", a.alte_mentiuni],
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="text-[15px]">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function PartyList({
  parties,
  emptyMsg,
  showCalitate,
}: { parties: RnpmParty[]; emptyMsg: string; showCalitate?: boolean }) {
  if (parties.length === 0) return <p className="text-sm text-muted-foreground">{emptyMsg}</p>;
  return (
    <div className="space-y-2">
      {parties.map((p) => (
        <div key={p.id} className="rounded-lg border border-border p-3">
          <div className="mb-1 flex items-center gap-2">
            {p.nr_ordine != null && <span className="text-[11px] text-muted-foreground font-mono">#{p.nr_ordine}</span>}
            <Badge variant="outline" className="text-[10px]">
              {p.tip_persoana}
            </Badge>
            {showCalitate && p.calitate && <Badge className="text-xs">{p.calitate}</Badge>}
            {p.subscriptor === 1 && (
              <Badge variant="secondary" className="text-xs">
                Subscriptor
              </Badge>
            )}
            <span className="text-sm font-medium">
              {p.tip_persoana === "PF" ? `${p.denumire ?? ""} ${p.prenume ?? ""}`.trim() : p.denumire}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px] text-muted-foreground">
            {p.tip_entitate && (
              <span className="col-span-2">
                Tipul: <span className="text-foreground">{p.tip_entitate}</span>
              </span>
            )}
            {p.cod && (
              <span>
                CUI: <span className="font-mono text-foreground">{p.cod}</span>
              </span>
            )}
            {p.cnp && (
              <span>
                CNP: <span className="font-mono text-foreground">{p.cnp}</span>
              </span>
            )}
            {p.nr_identificare && (
              <span>
                Nr. Reg: <span className="font-mono text-foreground">{p.nr_identificare}</span>
              </span>
            )}
            {p.sediu && (
              <span className="col-span-2">
                Sediu: <span className="text-foreground">{p.sediu}</span>
              </span>
            )}
            {(p.localitate || p.judet || p.tara) && (
              <span className="col-span-2">
                {p.localitate && <span className="text-foreground">{p.localitate}</span>}
                {p.judet && (
                  <span className="text-foreground">
                    {p.localitate ? `, sector/judet ${p.judet}` : `Sector/judet ${p.judet}`}
                  </span>
                )}
                {p.tara && <span className="text-foreground">{p.localitate || p.judet ? `, ${p.tara}` : p.tara}</span>}
              </span>
            )}
            {p.cod_postal && (
              <span>
                Cod postal: <span className="text-foreground">{p.cod_postal}</span>
              </span>
            )}
            {p.alte_date && (
              <span className="col-span-2">
                Alte date: <span className="text-foreground">{p.alte_date}</span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function BunuriList({ bunuri, detaliiComune }: { bunuri: RnpmBun[]; detaliiComune: string | null }) {
  return (
    <div className="space-y-3">
      {detaliiComune && <div className="rounded-lg bg-muted/30 p-3 text-xs whitespace-pre-wrap">{detaliiComune}</div>}
      {bunuri.length === 0 ? (
        <p className="text-sm text-muted-foreground">Fara bunuri listate.</p>
      ) : (
        bunuri.map((b) => (
          <div
            key={b.id}
            className="rounded-lg border border-border p-3"
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}
          >
            <Badge variant="outline" className="mb-1 text-[10px]">
              {b.tip_bun}
            </Badge>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {b.categorie && (
                <span>
                  <span className="text-muted-foreground">Categorie:</span> {b.categorie}
                </span>
              )}
              {b.model && (
                <span>
                  <span className="text-muted-foreground">Model:</span> {b.model}
                </span>
              )}
              {b.serie_sasiu && (
                <span>
                  <span className="text-muted-foreground">Sasiu:</span>{" "}
                  <span className="font-mono">{b.serie_sasiu}</span>
                </span>
              )}
              {b.nr_inmatriculare && (
                <span>
                  <span className="text-muted-foreground">Nr:</span>{" "}
                  <span className="font-mono">{b.nr_inmatriculare}</span>
                </span>
              )}
              {b.identificare && (
                <span className="col-span-2">
                  <span className="text-muted-foreground">Identificare:</span> {b.identificare}
                </span>
              )}
              {b.descriere && (
                <span className="col-span-2">
                  <span className="text-muted-foreground">Descriere:</span> {b.descriere}
                </span>
              )}
            </div>
            {b.referinte && b.referinte.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {b.referinte.map((r) => (
                  <BunRefRow key={JSON.stringify(r)} r={r} />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function BunRefRow({ r }: { r: RnpmBunPartyRef }) {
  const name = r.tip_persoana === "PF" ? `${r.denumire ?? ""} ${r.prenume ?? ""}`.trim() : (r.denumire ?? "");
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2">
      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
        <Badge
          className={cn(
            "text-xs text-white",
            r.rol === "tert" ? "bg-amber-600 hover:bg-amber-600" : "bg-sky-600 hover:bg-sky-600"
          )}
        >
          {r.rol === "tert" ? "Tert" : "Constituitor"}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {r.tip_persoana}
        </Badge>
        <span className="text-xs font-medium">{name}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13.5px] text-muted-foreground">
        {r.tip_entitate && (
          <span className="col-span-2">
            Tipul: <span className="text-foreground">{r.tip_entitate}</span>
          </span>
        )}
        {r.cod && (
          <span>
            CUI: <span className="font-mono text-foreground">{r.cod}</span>
          </span>
        )}
        {r.cnp && (
          <span>
            CNP: <span className="font-mono text-foreground">{r.cnp}</span>
          </span>
        )}
        {r.nr_identificare && (
          <span>
            Nr. Reg: <span className="font-mono text-foreground">{r.nr_identificare}</span>
          </span>
        )}
        {r.sediu && (
          <span className="col-span-2">
            Sediu: <span className="text-foreground">{r.sediu}</span>
          </span>
        )}
        {(r.localitate || r.judet || r.tara) && (
          <span className="col-span-2">
            {r.localitate && <span className="text-foreground">{r.localitate}</span>}
            {r.judet && (
              <span className="text-foreground">
                {r.localitate ? `, sector/judet ${r.judet}` : `Sector/judet ${r.judet}`}
              </span>
            )}
            {r.tara && <span className="text-foreground">{r.localitate || r.judet ? `, ${r.tara}` : r.tara}</span>}
          </span>
        )}
        {r.cod_postal && (
          <span>
            Cod postal: <span className="text-foreground">{r.cod_postal}</span>
          </span>
        )}
        {r.alte_date && (
          <span className="col-span-2">
            Alte date: <span className="text-foreground">{r.alte_date}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function istoricBadgeClass(tip: string): string {
  const t = tip.toLowerCase();
  if (t.includes("initial")) return "border-emerald-500/60 text-emerald-700 dark:text-emerald-400";
  if (t.includes("reducere") || t.includes("radiere") || t.includes("stingere"))
    return "border-rose-500/60 text-rose-700 dark:text-rose-400";
  if (t.includes("prelungire") || t.includes("extindere") || t.includes("cesiune"))
    return "border-sky-500/60 text-sky-700 dark:text-sky-400";
  if (t.includes("modificare") || t.includes("rectificare") || t.includes("completare"))
    return "border-amber-500/60 text-amber-700 dark:text-amber-400";
  return "";
}

function IstoricList({ istoric }: { istoric: RnpmAvizFull["istoric"] }) {
  if (istoric.length === 0) return <p className="text-sm text-muted-foreground">Fara modificari inregistrate.</p>;
  return (
    <ol className="space-y-2">
      {istoric.map((h) => (
        <li key={h.id} className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground">{h.data}</span>
            <Badge variant="outline" className={cn("text-xs", istoricBadgeClass(h.tip))}>
              {h.tip}
            </Badge>
          </div>
          <div className="mt-1 font-mono text-[13.5px] text-foreground">{h.identificator}</div>
        </li>
      ))}
    </ol>
  );
}
