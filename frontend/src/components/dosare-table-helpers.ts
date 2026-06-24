import { normalizeInstitutie } from "@/lib/institutii";

export function getStadiuBadgeColor(stadiu: string): string {
  const s = (stadiu ?? "").toLowerCase();
  if (s.includes("fond"))
    return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700";
  if (s.includes("apel"))
    return "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800";
  if (s.includes("recurs"))
    return "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800";
  if (s.includes("suspendat"))
    return "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
  return "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700";
}

export function getCategorieBadgeColor(categorie: string): string {
  const c = (categorie ?? "").toLowerCase();
  if (c.includes("penal"))
    return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  if (c.includes("civil"))
    return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  if (c.includes("contencios"))
    return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  if (c.includes("munc"))
    return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800";
  if (c.includes("faliment") || c.includes("insolven"))
    return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
  if (c.includes("profesioni"))
    return "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800";
  return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-700";
}

export function getSolutieBadgeVariant(solutie: string): "default" | "secondary" | "outline" | "success" | "warning" {
  const s = (solutie ?? "").toLowerCase();
  if (s.includes("admite") || s.includes("hotărâre") || s.includes("hotarare")) return "success";
  if (s.includes("respinge") || s.includes("perim")) return "warning";
  if (s.includes("amân")) return "secondary";
  return "outline";
}

export function formatInstitutie(raw: string): string {
  if (!raw) return "-";
  return normalizeInstitutie(raw);
}

// PortalJust SharePoint indexer nu retine sufixul de dosar asociat (/a, /a1, /a2 ...).
// Strip-ul cauta dosarul parinte ca search-ul sa returneze macar contextul; user-ul
// gaseste asociatii din pagina parinte.
export function getPortalJustUrl(numar: string): string {
  const parent = numar.replace(/\/a\d*$/i, "");
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(parent)}`;
}

// ICCJ dosare live on www.scj.ro, NOT portal.just.ro. The detail page keys off
// the internal id surfaced by the search, not the docket number (the same
// number can exist at a lower court in PortalJust — see PLAN §1.1).
export function getIccjUrl(iccjId: string): string {
  return `https://www.scj.ro/1094/Detalii-dosar?customQuery%5B0%5D.Key=id&customQuery%5B0%5D.Value=${encodeURIComponent(iccjId)}`;
}

// ICCJ search landing page (POST-based form; can't deep-link by number, but at least
// keeps id-less ICCJ rows on scj.ro instead of wrongly routing them to PortalJust).
const ICCJ_SEARCH_URL = "https://www.scj.ro/738/Cautare-dosare-si-parti";

// (getIccjUrl is also consumed by the Monitorizare ICCJ rows for deep-linking.)
// Source-aware external link. Never route an ICCJ dosar to PortalJust (Codex #6) — with an
// id go to the detail page; without an id (legacy id-less rows) go to the ICCJ search page.
export function getDosarExternalUrl(dosar: { numar: string; source?: string; iccjId?: string }): string {
  if (dosar.source === "iccj") return dosar.iccjId ? getIccjUrl(dosar.iccjId) : ICCJ_SEARCH_URL;
  return getPortalJustUrl(dosar.numar);
}
