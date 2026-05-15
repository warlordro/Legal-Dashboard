// Request-time input validation + numeric limits shared across /api/dosare,
// /api/termene and their load-more SSE variants.

export const MAX_PARAM_LENGTH = 200;
export const MAX_INSTITUTII = 50;
export const MAX_SOAP_FANOUT = 500;
export const MAX_DOSARE_RESPONSE = 5000;
export const MAX_EXISTING_ITEMS = 10000;
export const MAX_EXISTING_ITEM_LEN = 100;
export const MAX_LOADMORE_BODY = 512000;
export const MAX_SSE_INTERVALS = 120;
export const SSE_TIMEOUT_MS = 900000;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  // Ensure parsed date matches input (rejects e.g. 2024-02-30 → Mar 1)
  return d.toISOString().startsWith(dateStr);
}

export function validateParams(params: Record<string, string | undefined>): string | null {
  for (const [key, val] of Object.entries(params)) {
    if (val && val.length > MAX_PARAM_LENGTH) {
      return `Parametrul '${key}' depaseste lungimea maxima permisa`;
    }
    // Reject null bytes and control characters
    // biome-ignore lint/suspicious/noControlCharactersInRegex: range-ul blocheaza explicit caractere de control in input HTTP.
    if (val && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(val)) {
      return `Parametrul '${key}' contine caractere invalide`;
    }
  }
  if (params.dataStart && !isValidDate(params.dataStart)) {
    return "Format invalid pentru dataStart (asteptat: YYYY-MM-DD, data valida)";
  }
  if (params.dataStop && !isValidDate(params.dataStop)) {
    return "Format invalid pentru dataStop (asteptat: YYYY-MM-DD, data valida)";
  }
  return null;
}
