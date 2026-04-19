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

export function splitConcatenatedWords(text: string): string {
  if (text.includes(" ")) return text;
  const upper = text.toUpperCase();
  const result: string[] = [];
  let pos = 0;
  while (pos < upper.length) {
    let matched = false;
    for (const word of LEGAL_WORDS) {
      if (upper.startsWith(word, pos)) {
        result.push(word);
        pos += word.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (result.length > 0) {
        result[result.length - 1] += upper[pos];
      } else {
        result.push(upper[pos]);
      }
      pos++;
    }
  }
  return result.join(" ");
}

export function formatDocumentSedinta(raw: string): string {
  if (!raw) return "";
  return raw.split(" ").map(splitConcatenatedWords).join(" ")
    .replace(/\s+/g, " ").trim();
}
