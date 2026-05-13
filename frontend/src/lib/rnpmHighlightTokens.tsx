import type { ReactNode } from "react";

interface Interval {
  start: number;
  end: number;
}

const COMBINING_MARK_RE = /\p{M}/u;
const COMBINING_MARKS_RE = /\p{M}/gu;

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  const normChars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const decomp = s[i].normalize("NFD");
    for (const ch of decomp) {
      if (COMBINING_MARK_RE.test(ch)) continue;
      normChars.push(ch.toLowerCase());
      map.push(i);
    }
  }
  return { norm: normChars.join(""), map };
}

function normalizeToken(t: string): string {
  return t.normalize("NFD").replace(COMBINING_MARKS_RE, "").toLowerCase();
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

export function highlightTokens(text: string | null | undefined, tokens: string[]): ReactNode {
  if (text == null || text === "") return text ?? "";
  if (tokens.length === 0) return text;

  const { norm, map } = normalizeWithMap(text);
  const intervals: Interval[] = [];

  for (const token of tokens) {
    const normalizedToken = normalizeToken(token);
    if (normalizedToken.length === 0) continue;
    let from = 0;
    while (from <= norm.length - normalizedToken.length) {
      const idx = norm.indexOf(normalizedToken, from);
      if (idx === -1) break;
      const startOrig = map[idx];
      const endOrig = map[idx + normalizedToken.length - 1] + 1;
      intervals.push({ start: startOrig, end: endOrig });
      from = idx + 1;
    }
  }

  if (intervals.length === 0) return text;
  const merged = mergeIntervals(intervals);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const { start, end } = merged[i];
    if (start > cursor) out.push(text.substring(cursor, start));
    out.push(
      <mark key={`m-${i}`} className="rounded bg-yellow-200 px-0.5 text-gray-900">
        {text.substring(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) out.push(text.substring(cursor));
  return <>{out}</>;
}

export function anyTokenMatches(texts: Array<string | null | undefined>, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalizedTokens = tokens.map((token) => normalizeToken(token)).filter((token) => token.length > 0);
  if (normalizedTokens.length === 0) return true;
  for (const text of texts) {
    if (text == null || text === "") continue;
    const { norm } = normalizeWithMap(text);
    for (const token of normalizedTokens) {
      if (norm.includes(token)) return true;
    }
  }
  return false;
}
