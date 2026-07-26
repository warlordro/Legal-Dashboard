# Task pentru Composr 2.5 — Strip suffix juridic din highlight + filtre client-side (Path A)

## Context

Aplicatie Electron + React 18 + TypeScript + Vite (frontend) si Hono + better-sqlite3 (backend) pentru cautare dosare la portalquery.just.ro (SOAP).

Cand user-ul cauta `SC ACME SRL` in "Cautare Dosare":
- query-ul SOAP catre PortalJust ramane **neschimbat** (verbatim) — NU atinge wire-ul,
- highlight-ul galben din tabel coloreaza in prezent si tokenii `SC`/`SRL`/`SA`/etc., desi acestia sunt forma juridica, nu identitate,
- filtrul intern dupa rol (creditor/debitor/etc.) din `Dosare.tsx` si analiza din `MetricsPanel.tsx` cer `every(word).includes(...)` peste tot textul, deci pot pica fals daca partea din rezultat e scrisa fara `SC`/`SRL`.

Scope-ul task-ului: corectie chirurgicala doar in frontend, fara nicio schimbare la backend / SOAP / DB / monitoring.

## Obiectiv

1. Introdu un helper partajat care recunoaste tokenii de forma juridica (legal suffix/prefix).
2. Highlight-ul nu coloreaza acesti tokeni.
3. Filtrele client-side (`filterByRoles` din `Dosare.tsx` si `partyAnalysis` din `MetricsPanel.tsx`) ignora acesti tokeni cand compara cu numele partilor.
4. Unit tests pentru helper si pentru highlight.
5. `npx biome check --write`, `npx tsc --noEmit` si testele trebuie sa treaca.

## Constrangeri stricte

- **NU modifica** `backend/`, `electron/`, `scripts/`, SOAP body, repository-uri DB, snapshot-uri monitoring, regex-uri de SQL LIKE.
- **NU schimba** semantica trimisa la `/api/v1/dosare/search` (request body ramane verbatim cum tasteaza user-ul).
- **NU adauga** dependinte noi.
- **NU sterge** comentarii sau cod adiacent care nu participa la fix.
- Limba: cod si comentarii in engleza; mesaje UI nu se schimba (nu exista mesaje noi).

## Pasul 1 — Helper partajat

Creeaza `frontend/src/lib/legalSuffix.ts`:

```ts
// Romanian and common foreign legal-form tokens. These describe how the
// entity is organized, not its identity, so highlight/filter UX should not
// treat them as identifying tokens. Match is case-insensitive and applied
// AFTER stripDiacritics + toUpperCase, so list only the bare ASCII forms.
export const LEGAL_FORM_TOKENS: ReadonlySet<string> = new Set([
  // Romanian
  "SC", "SRL", "SA", "SCA", "SNC", "SCS", "PFA", "IF", "II", "ONG",
  // Foreign — appear in cross-border parties on PortalJust
  "LLC", "LTD", "INC", "GMBH", "AG", "BV", "NV", "SAS", "SARL", "OY", "AB",
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
```

Creeaza `frontend/src/lib/legalSuffix.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dropLegalFormTokens, isLegalFormToken } from "./legalSuffix";

describe("isLegalFormToken", () => {
  it("recognises Romanian forms case-insensitively", () => {
    for (const t of ["SC", "sc", "Srl", "SA", "pfa"]) {
      expect(isLegalFormToken(t)).toBe(true);
    }
  });

  it("recognises common foreign forms", () => {
    for (const t of ["LLC", "Ltd", "GmbH", "SARL"]) {
      expect(isLegalFormToken(t)).toBe(true);
    }
  });

  it("rejects identity tokens", () => {
    for (const t of ["acme", "banca", "transilvania", "dacia", "auto"]) {
      expect(isLegalFormToken(t)).toBe(false);
    }
  });

  it("handles empty input", () => {
    expect(isLegalFormToken("")).toBe(false);
  });
});

describe("dropLegalFormTokens", () => {
  it("drops SC prefix and SRL suffix from a tokenised query", () => {
    expect(dropLegalFormTokens(["sc", "acme", "srl"])).toEqual(["acme"]);
  });

  it("keeps multi-word identities intact", () => {
    expect(dropLegalFormTokens(["banca", "transilvania", "sa"])).toEqual(["banca", "transilvania"]);
  });

  it("returns empty array when input is only legal forms", () => {
    expect(dropLegalFormTokens(["sc", "srl"])).toEqual([]);
  });

  it("passes through queries without legal forms", () => {
    expect(dropLegalFormTokens(["dacia"])).toEqual(["dacia"]);
  });
});
```

## Pasul 2 — Highlight (fisier existent)

Fisier: `frontend/src/components/dosare-table-highlight.tsx`.

Linia curenta (in functia `HighlightName`):

```ts
const searchWords = stripDiacritics(search.toLowerCase()).trim().split(/\s+/).filter(Boolean);
```

Modifica DOAR aceasta linie pentru a filtra tokenii de forma juridica DUPA split. Adauga import-ul. Comportament: daca user-ul a tastat `SC ACME SRL`, `searchWords` devine `["acme"]`; daca a tastat doar `SC SRL` (caz absurd), pastreaza tokenii originali ca fallback (sa nu se intample sa nu coloreze nimic deloc).

Diff dorit:

```ts
import { dropLegalFormTokens } from "../lib/legalSuffix";
// ...
const rawWords = stripDiacritics(search.toLowerCase()).trim().split(/\s+/).filter(Boolean);
const filtered = dropLegalFormTokens(rawWords);
// Fallback: if the user typed ONLY legal-form tokens, keep them so we still
// highlight something rather than rendering an empty match set.
const searchWords = filtered.length > 0 ? filtered : rawWords;
```

Restul functiei ramane neatins (sorted longest-first + regex + lookarounds Unicode raman cum sunt).

Adauga teste in `frontend/src/components/dosare-table-highlight.test.tsx` (creeaza fisierul daca nu exista; foloseste `@testing-library/react` si `vitest`, deja prezente in proiect). Acopera:
1. `SC ACME SRL` peste textul `SC ACME SRL` -> doar `ACME` are clasa de highlight; `SC` si `SRL` sunt in `<span>` simplu.
2. `BANCA TRANSILVANIA SA` peste `BANCA COMERCIALA TRANSILVANIA SA` -> highlight pe `BANCA` si `TRANSILVANIA`, `SA` simplu.
3. `acme` peste `S.C. Acme S.R.L.` -> highlight pe `Acme` (punctuatia separa).
4. Search gol -> textul render plain (existing).
5. Search doar `SC SRL` -> fallback: ambele tokeni sunt highlight-uite (nu vrem zero highlight).

## Pasul 3 — Filtrul rolurilor in `Dosare.tsx`

Fisier: `frontend/src/pages/Dosare.tsx`.

Linia 52-61, functia `filterByRoles`. Inlocuieste split-ul brut cu split + drop legal forms; pastreaza acelasi fallback (daca dupa filtrare tokenii sunt zero, foloseste cei originali ca sa nu colapsam rezultatele).

```ts
import { dropLegalFormTokens } from "@/lib/legalSuffix"; // sau "../lib/legalSuffix" daca path-ul absolut nu e configurat
// ...
function filterByRoles(dosare: Dosar[], roles: string[], searchedName?: string): Dosar[] {
  if (roles.length === 0 || !searchedName) return dosare;
  const rawWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  const filtered = dropLegalFormTokens(rawWords);
  const searchWords = filtered.length > 0 ? filtered : rawWords;
  return dosare.filter((d) =>
    d.parti.some(
      (p) =>
        searchWords.every((w) => stripDiacritics(p.nume.toLowerCase()).includes(w)) && roles.includes(p.calitateParte)
    )
  );
}
```

Verifica path-ul de import: foloseste convensia existenta din fisier pentru import-uri din `lib/`.

## Pasul 4 — `partyAnalysis` in `MetricsPanel.tsx`

Fisier: `frontend/src/components/MetricsPanel.tsx`, blocul `useMemo` numit `partyAnalysis` (L98-116).

Aplica exact aceeasi modificare semantica:

```ts
const partyAnalysis = useMemo(() => {
  if (!searchedName) return null;
  const rawWords = stripDiacritics(searchedName.toLowerCase()).trim().split(/\s+/).filter(Boolean);
  const filtered = dropLegalFormTokens(rawWords);
  const searchWords = filtered.length > 0 ? filtered : rawWords;
  if (searchWords.length === 0) return null;
  const roleMap: Record<string, number> = {};
  for (const d of dosare) {
    for (const p of d.parti) {
      const nameLower = stripDiacritics(p.nume.toLowerCase());
      if (searchWords.every((w) => nameLower.includes(w))) {
        const role = p.calitateParte || "Necunoscut";
        roleMap[role] = (roleMap[role] || 0) + 1;
      }
    }
  }
  return Object.entries(roleMap)
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}, [dosare, searchedName]);
```

Adauga import-ul `dropLegalFormTokens` la fel ca in `Dosare.tsx`.

## Pasul 5 — Verificari obligatorii inainte de "done"

Ruleaza in ordine (toate trebuie sa treaca):

```bash
npx biome check --write frontend/src/lib/legalSuffix.ts frontend/src/lib/legalSuffix.test.ts frontend/src/components/dosare-table-highlight.tsx frontend/src/components/dosare-table-highlight.test.tsx frontend/src/pages/Dosare.tsx frontend/src/components/MetricsPanel.tsx
cd frontend && npx tsc --noEmit
cd frontend && npm test -- --run
```

Daca biome reformateaza, re-rezolva testele si type-check-ul dupa formatare.

## Definition of done

- `frontend/src/lib/legalSuffix.ts` + `legalSuffix.test.ts` create, testele trec.
- `dosare-table-highlight.tsx` modificat strict pe linia indicata; test file creat (sau extins) cu cele 5 cazuri; testele trec.
- `Dosare.tsx::filterByRoles` si `MetricsPanel.tsx::partyAnalysis` folosesc `dropLegalFormTokens` cu fallback la tokenii originali.
- Niciun fisier din `backend/`, `electron/`, `scripts/` nu e atins.
- `biome check`, `tsc --noEmit`, `vitest --run` trec curat.
- Commit single, mesaj sugerat: `fix(ui): nu mai colora forma juridica (SC/SRL/SA) in highlight si filtre client-side`.

## Non-goals explicite

- NU modifica request-ul SOAP.
- NU schimba snapshot version (`monitoring_snapshots.version`).
- NU atinge `nameSoapRunner.ts` sau alte fisiere din `backend/src/services/monitoring/`.
- NU genera CHANGELOG.md / release notes / version bump — task-ul e doar fix UI; release-ul il fac eu manual ulterior.
