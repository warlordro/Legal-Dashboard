// v2.41.0: sursa unica de etichete umane pentru feature-urile de cota.
// Conventia cross-stack din CLAUDE.md: enum-urile backend nu se afiseaza raw
// in DOM — orice token trece printr-un helper de traducere cu fallback.
// Importat de Cote + Granturi (si, din v2.42, de Consum) — nu duplica map-uri.

// v2.42.0 (5.2): pool AI unic — enum-ul de cota devine ["ai", "captcha.rnpm"].
// ai.single/ai.multi raman DOAR ca etichete lizibile pentru randuri legacy.
export const QUOTA_FEATURES = ["ai", "captcha.rnpm", "rnpm.storage"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];

const LABELS: Record<QuotaFeature, string> = {
  ai: "AI — toate analizele (limita unica)",
  "captcha.rnpm": "Captcha RNPM",
  "rnpm.storage": "Stocare RNPM",
};

// Etichete pentru feature-uri legacy (pre-consolidare 0041) — raman lizibile
// in tabele/istoric, dar nu mai sunt selectabile in formulare.
const LEGACY_LABELS: Record<string, string> = {
  "ai.single": "AI — analiza simpla (vechi)",
  "ai.multi": "AI — analiza multi-model (vechi)",
};

export function isKnownQuotaFeature(feature: string): feature is QuotaFeature {
  return (QUOTA_FEATURES as readonly string[]).includes(feature);
}

// Fallback localizat "Necunoscut (token)": un feature in afara enum-ului si a
// listei legacy ramane lizibil in tabel (token-ul brut pastrat in paranteze
// pentru diagnosticare), dar salvarea lui e blocata in formular (vezi Quota.tsx).
export function quotaFeatureLabel(feature: string): string {
  if (isKnownQuotaFeature(feature)) return LABELS[feature];
  return LEGACY_LABELS[feature] ?? `Necunoscut (${feature})`;
}

// Unitatea limitei per feature: USD pentru ai.*, numar de captcha-uri pentru
// captcha.* (conventia stocarii din v2.34.0: limit_usd_milli = count brut).
export type QuotaFeatureUnit = "usd" | "count" | "mb";

export function quotaFeatureUnit(feature: string): QuotaFeatureUnit {
  if (feature === "rnpm.storage") return "mb";
  if (feature.startsWith("captcha.")) return "count";
  return "usd";
}

export function isCountFeature(feature: string): boolean {
  return quotaFeatureUnit(feature) === "count";
}

export function quotaLimitUnitLabel(feature: string): string {
  const unit = quotaFeatureUnit(feature);
  if (unit === "count") return "captcha-uri";
  if (unit === "mb") return "MB";
  return "USD";
}
