import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string, timeStr?: string): string {
  const date = formatDate(dateStr);
  if (!timeStr) return date;
  return `${date} ${timeStr}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatRoNumber(n: number): string {
  return n.toLocaleString("ro-RO");
}

// Known Romanian legal words, longest first for greedy matching
// NOTE: avoid short words (1-2 chars) — they cause false splits in longer words
const LEGAL_WORDS = [
  // Documente
  "INCHEIERE", "HOTARARE", "SENTINTA", "DECIZIE", "MINUTA",
  "PROCES", "VERBAL", "REZOLUTIE", "ORDONANTA",
  // Acțiuni / stări — longer variants first
  "PRONUNTARII", "PRONUNTAREA", "PRONUNTARE",
  "DEZINVESTIRE", "REINVESTIRE", "INVESTIRE",
  "INDREPTARE", "INDREPT",
  "AMANARE", "SUSPENDARE", "REPUNERE", "REDESCHIDERE",
  "REJUDECARE", "JUDECARE", "JUDECATA",
  "ADMITERE", "RESPINGERE", "ANULARE", "CASARE",
  "CONEXARE", "DISJUNGERE", "DECLINARE",
  "STRAMUTARE", "RECUZARE", "ABTINERE",
  "REEXAMINARE", "EXAMINARE",
  // Erori / rectificări
  "EROARE", "MATERIALA", "RECTIFICARE", "LAMURIRE",
  // Calificative
  "INTERMEDIARA", "ULTERIOARA", "INITIALA",
  "FINALA", "PARTIALA", "TOTALA",
  "PRELIMINARA", "DEFINITIVA", "PROVIZORIE",
  "COMERCIALA", "ADMINISTRATIVA",
  "PENALA", "CIVILA", "CONTRAVENTIONALA",
  // Locuri / contexte
  "SEDINTA", "CAMERA", "SALA", "COMPLET",
  "INSTANTA", "TRIBUNAL", "CURTEA", "JUDECATORIE",
  "PARCHET", "MINISTER",
  // Participanți
  "RECLAMANT", "PARAT", "INTERVENIENT", "MARTOR",
  "EXPERT", "AVOCAT", "PROCUROR", "JUDECATOR",
  // Alte cuvinte juridice
  "APEL", "RECURS", "CONTESTATIE", "CERERE",
  "FOND", "CAUZA", "DOSAR", "PROBE",
  "TERMEN", "CITARE", "COMUNICARE",
  "EXECUTARE", "SILITA",
  // Prepoziții / conjuncții — minimum 3 chars to avoid false splits
  "PENTRU", "PRIN", "SPRE", "DUPA", "FARA",
  "DIN", "NR", "ART",
].sort((a, b) => b.length - a.length);

// 1-2 char connectors deliberately excluded from LEGAL_WORDS (would cause false
// splits inside longer words). Recognized in the unmatched-run fallback so they
// emit as standalone tokens instead of gluing to the previous word — fixes
// "INCHEIEREDE", "INITIALAA", "ULTERIOARAA" coming from PortalJust SOAP.
const SHORT_CONNECTORS = new Set(["DE", "A", "LA", "PE", "CU", "IN", "SI"]);

export function splitConcatenatedWords(text: string): string {
  if (text.includes(" ")) return text;
  const upper = text.toUpperCase();
  const result: string[] = [];
  let pos = 0;
  while (pos < upper.length) {
    let matched: string | null = null;
    for (const word of LEGAL_WORDS) {
      if (upper.startsWith(word, pos)) { matched = word; break; }
    }
    if (matched) {
      result.push(matched);
      pos += matched.length;
      continue;
    }
    // Unmatched run — scan to next known-word boundary (or end).
    let nextWordPos = pos + 1;
    while (nextWordPos < upper.length) {
      if (LEGAL_WORDS.some((w) => upper.startsWith(w, nextWordPos))) break;
      nextWordPos++;
    }
    const run = upper.slice(pos, nextWordPos);
    if (SHORT_CONNECTORS.has(run) || nextWordPos < upper.length) {
      // Known connector OR a gap before a future word — emit as its own token.
      result.push(run);
    } else if (result.length > 0) {
      // Trailing junk (punctuation, digits) — keep glued to previous word.
      result[result.length - 1] += run;
    } else {
      result.push(run);
    }
    pos = nextWordPos;
  }
  return result.join(" ");
}

export function formatDocumentSedinta(raw: string): string {
  if (!raw) return "";
  return raw.split(" ").map(splitConcatenatedWords).join(" ")
    .replace(/\s+/g, " ").trim();
}
