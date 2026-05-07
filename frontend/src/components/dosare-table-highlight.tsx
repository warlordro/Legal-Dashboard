export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Expand a plain character to a regex class matching all Romanian diacritic variants
const DIAC_MAP: Record<string, string> = {
  a: "[aăâ]", A: "[AĂÂ]",
  i: "[iî]", I: "[IÎ]",
  s: "[sșş]", S: "[SȘŞ]",
  t: "[tțţ]", T: "[TȚŢ]",
};

function expandDiacritics(word: string): string {
  return [...word].map((c) => DIAC_MAP[c] ?? c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
}

export function HighlightName({ text, search }: { text: string; search?: string }) {
  if (!search || !text) return <>{text}</>;
  const searchWords = stripDiacritics(search.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  if (searchWords.length === 0) return <>{text}</>;

  // Sort longest-first so "demolari" wins alternation over "de" inside "DEMOLARI".
  // Unicode-aware lookarounds prevent short tokens (e.g. "de") from matching
  // as prefix/suffix of longer words (DEPOZIT, DECIZIE, etc.).
  const sortedWords = [...searchWords].sort((a, b) => b.length - a.length);
  const patterns = sortedWords.map((w) => expandDiacritics(w));
  const regex = new RegExp(`(?<!\\p{L})(${patterns.join("|")})(?!\\p{L})`, "giu");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = searchWords.some((w) => stripDiacritics(part.toLowerCase()) === w);
        return isMatch ? (
          <span key={i} className="rounded bg-yellow-200 px-0.5 font-semibold text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-200">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}
