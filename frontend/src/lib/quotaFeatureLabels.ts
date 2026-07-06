// v2.41.0: sursa unica de etichete umane pentru feature-urile de cota.
// Conventia cross-stack din CLAUDE.md: enum-urile backend nu se afiseaza raw
// in DOM — orice token trece printr-un helper de traducere cu fallback.
// Importat de Cote + Granturi (si, din v2.42, de Consum) — nu duplica map-uri.

export const QUOTA_FEATURES = ["ai.single", "ai.multi", "captcha.rnpm"] as const;
export type QuotaFeature = (typeof QUOTA_FEATURES)[number];

const LABELS: Record<QuotaFeature, string> = {
  "ai.single": "AI — analiza simpla",
  "ai.multi": "AI — analiza multi-model",
  "captcha.rnpm": "Captcha RNPM",
};

export function isKnownQuotaFeature(feature: string): feature is QuotaFeature {
  return (QUOTA_FEATURES as readonly string[]).includes(feature);
}

// Fallback pe token-ul brut: un feature legacy (in afara enum-ului) ramane
// lizibil in tabel, dar salvarea lui e blocata in formular (vezi Quota.tsx).
export function quotaFeatureLabel(feature: string): string {
  return isKnownQuotaFeature(feature) ? LABELS[feature] : feature;
}

// Unitatea limitei per feature: USD pentru ai.*, numar de captcha-uri pentru
// captcha.* (conventia stocarii din v2.34.0: limit_usd_milli = count brut).
export function isCountFeature(feature: string): boolean {
  return feature.startsWith("captcha.");
}

export function quotaLimitUnitLabel(feature: string): string {
  return isCountFeature(feature) ? "captcha-uri" : "USD";
}
