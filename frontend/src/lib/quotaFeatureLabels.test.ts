import { describe, expect, it } from "vitest";
import {
  QUOTA_FEATURES,
  isCountFeature,
  isKnownQuotaFeature,
  quotaFeatureLabel,
  quotaFeatureUnit,
  quotaLimitUnitLabel,
} from "./quotaFeatureLabels";

describe("quotaFeatureLabels", () => {
  it("traduce toate feature-urile din enum in etichete umane (fara token raw)", () => {
    for (const f of QUOTA_FEATURES) {
      const label = quotaFeatureLabel(f);
      expect(label).not.toBe(f);
      expect(label.length).toBeGreaterThan(0);
    }
    // v2.42.0 (5.2): pool AI unic in enum; legacy raman etichete lizibile.
    expect(quotaFeatureLabel("ai")).toBe("AI — toate analizele (limita unica)");
    expect(quotaFeatureLabel("captcha.rnpm")).toBe("Captcha RNPM");
    expect(quotaFeatureLabel("rnpm.storage")).toBe("Stocare RNPM");
    expect(quotaFeatureLabel("ai.single")).toBe("AI — analiza simpla (vechi)");
  });

  it("feature necunoscut: fallback localizat cu tokenul in paranteze si isKnown=false", () => {
    expect(quotaFeatureLabel("dosar_summary")).toBe("Necunoscut (dosar_summary)");
    expect(quotaFeatureLabel("mystery")).toBe("Necunoscut (mystery)");
    expect(isKnownQuotaFeature("dosar_summary")).toBe(false);
    expect(isKnownQuotaFeature("ai.single")).toBe(false); // legacy, iesit din enum
    expect(isKnownQuotaFeature("ai")).toBe(true);
  });

  it("unitatea limitei foloseste descriptorul usd/count/mb per feature", () => {
    expect(isCountFeature("captcha.rnpm")).toBe(true);
    expect(isCountFeature("ai.single")).toBe(false);
    expect(isCountFeature("rnpm.storage")).toBe(false);
    expect(quotaFeatureUnit("ai")).toBe("usd");
    expect(quotaFeatureUnit("captcha.rnpm")).toBe("count");
    expect(quotaFeatureUnit("rnpm.storage")).toBe("mb");
    expect(quotaLimitUnitLabel("captcha.rnpm")).toBe("captcha-uri");
    expect(quotaLimitUnitLabel("rnpm.storage")).toBe("MB");
    expect(quotaLimitUnitLabel("ai.multi")).toBe("USD");
  });
});
