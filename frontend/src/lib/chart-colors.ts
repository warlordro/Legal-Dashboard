// Single source of truth for chart fill colors. Recharts requires literal CSS
// color values for SVG fills, so these can't come from theme tokens directly.
// Re-theming or dark-mode chart variants happens here, in one place.

export const CATEGORY_COLORS: Record<string, string> = {
  Penal: "#ef4444",
  Civil: "#3b82f6",
  Contencios: "#22c55e",
  "Litigii munca": "#a855f7",
  Faliment: "#f59e0b",
  Profesionisti: "#14b8a6",
  Altele: "#6b7280",
};

export const CATEGORY_FALLBACK = "#6b7280";

// Generic fills used by single-series bar charts.
export const CHART_FILLS = {
  primary: "#3b82f6", // blue — neutral default for stadii/role bars
  accent: "#14b8a6", // teal — secondary series (institutii)
  termene: "#a855f7", // purple — termene/calendar series
  aiUsage: "#0ea5e9", // sky - AI usage cost trend
} as const;
