import { normalizeInstitutie } from "@/lib/institutii";

export function getStadiuBadgeColor(stadiu: string): string {
  const s = (stadiu ?? "").toLowerCase();
  if (s.includes("fond")) return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700";
  if (s.includes("apel")) return "bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800";
  if (s.includes("recurs")) return "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800";
  if (s.includes("suspendat")) return "bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
  return "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700";
}

export function getCategorieBadgeColor(categorie: string): string {
  const c = (categorie ?? "").toLowerCase();
  if (c.includes("penal")) return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800";
  if (c.includes("civil")) return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
  if (c.includes("contencios")) return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  if (c.includes("munc")) return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800";
  if (c.includes("faliment") || c.includes("insolven")) return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800";
  if (c.includes("profesioni")) return "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-800";
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

export function getPortalJustUrl(numar: string): string {
  return `https://portal.just.ro/SitePages/cautare.aspx?k=${encodeURIComponent(numar)}`;
}
