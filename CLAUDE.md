# Legal Dashboard — Context Proiect

## Descriere
Aplicatie Electron desktop pentru cautare dosare si termene (portalquery.just.ro, SOAP) **+ tab Cautare RNPM** (Registrul National de Publicitate Mobiliara, via HTTP cu rezolvare captcha 2Captcha). Fork / extindere a PortalJust Dashboard v1.4.4-ai — PortalJust ramane aplicatie separata.

## Versiune Curenta
**v1.0.0** — 15 Aprilie 2026

## Status implementare
Vezi `STATUS.md` pentru progres detaliat. 9/10 pasi completi — ramas doar `npm run dist` pentru installer.

## Structura Proiect
```
portaljust-dashboard/
├── frontend/          # React + TypeScript + Vite + Tailwind + shadcn/ui
│   └── src/
│       ├── pages/     # Dashboard, Dosare, Termene, Changelog
│       ├── components/# DosareTable, TermeneTable, Sidebar, CalendarView, SearchForm, ui/
│       ├── hooks/     # useTheme, useFontSize, useApiKey, useSearchHistory
│       ├── lib/       # api.ts, export.ts (Excel/PDF), utils.ts
│       └── types/     # TypeScript interfaces (Dosar, Termen, etc.)
├── backend/           # Node.js + Hono (port 3001)
│   └── src/
│       ├── index.ts   # API routes, AI endpoint, SSE load-more, rate limiter, static serving
│       ├── soap.ts    # SOAP client for PortalJust (CautareDosare, CautareTermene)
│       └── intervals.ts # Date interval utilities for monthly batch pagination
├── electron/          # Electron shell
│   └── main.js        # BrowserWindow, context menu, CSP, security
├── scripts/           # build.js (frontend + backend + copy)
├── build/             # Icons (icon.ico, icon-1024.png)
├── CHANGELOG.md       # Changelog complet per versiune
└── release/           # Output installer (.exe)
```

## Comenzi
- `npm run dev` — porneste frontend (5173) + backend (3001) in paralel
- `npm run build` — build frontend + backend
- `npm run dist` — build + electron-builder (NSIS installer Windows)
- Frontend dev: `cd frontend && npm run dev`
- Backend dev: `cd backend && npm run dev`

## Arhitectura
- **Frontend**: React 19, Vite 5, Tailwind CSS, shadcn/ui, Recharts
- **Backend**: Hono framework, SOAP XML parsing manual (fara dependenta soap)
- **AI**: Anthropic SDK, OpenAI SDK, Google Generative AI SDK
- **Export**: xlsx-js-style (drop-in xlsx cu styling celule), jspdf + jspdf-autotable (dynamic import)
- **Desktop**: Electron 41 + electron-builder (NSIS, per-user install, fara admin)
- **Build**: esbuild (backend -> CJS), Vite (frontend)
- **Routing**: Dosare si Termene sunt mereu montate (display:none cand inactive) — operatiile async supravietuiesc navigarii
- **Filtrare date client-side**: Data Start/Data Stop filtreaza instant rezultatele deja incarcate (fara re-cautare SOAP) pe ambele pagini

## Load More — Paginare Extinsa
SOAP API returneaza max 1000 rezultate per request. "Incarca mai multe" scaneaza luna cu luna prin SSE:
- **Backend**: `POST /api/dosare/load-more` si `POST /api/termene/load-more` (SSE stream)
- **Batch pagination**: `intervals.ts` genereaza intervale lunare, cu subdivizare recursiva daca o luna depaseste 1000
- **Deduplicare**: Backend primeste numerele dosarelor existente via POST body, trimite doar dosare NOI
- **Frontend**: Merge incremental pe fiecare batch event, progress arata totalul unic real
- **Stop**: Pastreaza rezultatele partiale deja primite (merge incremental = nimic pierdut)
- **Vite proxy**: Timeout 600s pentru SSE endpoints
- **Limite securitate**: Max 120 intervale (~10 ani), timeout 10 minute pe stream, body 500KB max

## AI Multi-Provider
- Endpoint unic: `POST /api/ai/analyze`
- Provideri: Anthropic (Claude), OpenAI (GPT-4), Google (Gemini)
- Cheile API se salveaza obfuscate in localStorage (btoa+reverse), trimise per-request
- Backend accepta si chei din .env (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_KEY)
- **max_tokens/max_output_tokens: 8000** pe toti providerii (explicit setat)
- **Timeout backend**: 120s per apel AI
- **Timeout frontend**: 180s (single), 300s (multi-agent)
- Truncation prompt: obiect 500 chars, nume parte 200 chars, solutie sedinta 10000 chars
- Toate sedintele sunt incluse in prompt (fara limita de numar)

## Securitate (Audit Complet — 29 Martie 2026)
### Protectii active
- DOMPurify pe toate dangerouslySetInnerHTML (protectie XSS din raspunsuri AI)
- Sanitizare erori API (fara leak chei/stack traces catre client)
- Body size limit 100KB pe AI, 500KB pe load-more POST
- Schema validation pe AI request body si load-more existing array (max 10000 elem, max 100 chars/elem)
- JSON.parse wrapped in try-catch dedicat pe toate endpoint-urile
- SSE timeout 10 minute + max 120 intervale lunare
- API keys obfuscate in localStorage (nu plaintext)
- Rate limiter fix (nu foloseste X-Forwarded-For)
- Validare date reale (30 feb respins)
- SOAP fault sanitizat (detalii doar in log)
- Bind localhost only (127.0.0.1)
- Path traversal protection
- CSP headers in Electron (fara data: URI)
- CORS restrictiv (doar localhost:5173/4173)
- XML escape complet in SOAP
- Sandbox + contextIsolation + enableRemoteModule:false in Electron
- DevTools dezactivate in productie (activabile cu --dev-tools flag)
- External URL whitelist exact (portal.just.ro, www.just.ro, portalquery.just.ro)

### Riscuri acceptate
- SOAP HTTP (portalquery.just.ro nu ofera HTTPS) — date publice, fara autentificare
- XML regex parsing (nu parser dedicat) — functioneaza corect cu formatul fix MJ

## Nota Importanta Build
- Backend-ul e compilat ca CJS de esbuild. `import.meta.url` nu functioneaza in CJS.
  Se foloseste `typeof __dirname !== "undefined" ? __dirname : ...` pentru compatibilitate.
- `optimizeDeps.include` in vite.config.ts e necesar pentru xlsx-js-style, jspdf, jspdf-autotable
  (altfel dynamic import esueaza silentios in browser)
- `npm run dist:server` — genereaza pachet ZIP deployabil pe server (dist-backend + dist-frontend + Dockerfile)

## Limba
- Interfata si mesajele sunt in **romana**
- Comentariile din cod pot fi in engleza sau romana
