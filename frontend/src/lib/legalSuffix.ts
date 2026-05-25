// Romanian and common foreign legal-form tokens. These describe how the
// entity is organized, not its identity, so highlight/filter UX should not
// treat them as identifying tokens. Match is case-insensitive and applied
// AFTER stripDiacritics + toUpperCase, so list only the bare ASCII forms.
export const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  // Romanian
  "SC",
  "SRL",
  "SA",
  "SCA",
  "SNC",
  "SCS",
  "PFA",
  "IF",
  "II",
  "ONG",
  // Foreign — appear in cross-border parties on PortalJust
  "LLC",
  "LTD",
  "INC",
  "GMBH",
  "AG",
  "BV",
  "NV",
  "SAS",
  "SARL",
  "OY",
  "AB",
]);

export function isLegalFormToken(token: string): boolean {
  if (!token) return false;
  return LEGAL_FORM_TOKENS.has(token.toUpperCase());
}

// Filter out legal-form tokens from a pre-split list of identity words.
// Input tokens should already be normalised (stripDiacritics + lowercased
// or uppercased — comparison is case-insensitive).
export function dropLegalFormTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !isLegalFormToken(t));
}
