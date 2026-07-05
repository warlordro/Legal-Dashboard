// Vocabularul RO al feature-urilor de cota (backend: QUOTA_FEATURES din
// quotaGuard.ts) — sursa unica pentru Cote, Granturi si Consum (CodeRabbit:
// era duplicat intre FEATURE_OPTIONS din Quota si FEATURE_LABELS din Grants).
export const QUOTA_FEATURE_LABELS: Record<string, string> = {
  ai: "AI — toate analizele (limita unica)",
  "captcha.rnpm": "Captcha RNPM",
};

export function quotaFeatureLabel(feature: string): string {
  return QUOTA_FEATURE_LABELS[feature] ?? feature;
}
