export function todayRo(): string {
  return new Date().toLocaleDateString("ro-RO");
}

export function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}
