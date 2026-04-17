# Legal Dashboard — Instructiuni Pornire

## Cerinte
- Node.js 20+ (testat pe v24)
- npm 10+

## Prima Rulare

```bash
cd "Legal Dashboard"
npm install
```

## Pornire

### Mod Electron desktop (default)
```bash
npm start
```
Porneste backend in-process + renderer Vite + fereastra Electron. DB locala: `userData/legal-dashboard.db` (via env `LEGAL_DASHBOARD_DB_PATH`). 2Captcha key + preferinte se configureaza din UI → dialog "Setari AI".

### Mod dev split (optional — browser standalone)
Terminal 1 — backend (port 3001):
```bash
cd backend
npm run dev
```
Terminal 2 — frontend (port 5173):
```bash
cd frontend
npm run dev
```
Deschide **http://localhost:5173** in browser.

### Build installer
```bash
npm run dist
```
Genereaza `release/Legal Dashboard Setup X.Y.Z.exe`.

---

## Functionalitati

| Feature | Descriere |
|---|---|
| Cautare Dosare | PortalJust SOAP — dupa numar, parte, obiect, tip instanta |
| Termene & Calendar | Filtrare pe interval, vizualizare lunara |
| **Cautare RNPM** | Registrul National de Publicitate Mobiliara (captcha auto) |
| → Cautare | 5 categorii: ipoteci / fiducii / specifice / creante / obligatiuni ipotecare |
| → Bulk | Procesare liste CUI / CNP cu SSE progress |
| → Baza locala | Browser SQLite cu filtru text (diacritic-insensibil), data range, categorie, activ |
| Export Excel / PDF | Dosare, Termene, Avize RNPM |
| AI Analiza | Multi-provider (OpenAI / Anthropic / Google) + multi-agent |
| Dark Mode | Toggle in sidebar |

---

## API Externe

| Sursa | Endpoint | Auth |
|---|---|---|
| PortalJust | SOAP `http://portalquery.just.ro/query.asmx` (CautareDosare, CautareTermene) | — |
| RNPM | REST `https://mj.rnpm.ro/api/*` (search + detail part 1-4 + istoric) | reCAPTCHA v2 (sitekey `6Lff9LsU...`) |
| 2Captcha | `https://api.2captcha.com` sau CapSolver (fallback) | API key per user |

---

## Troubleshooting

- **"Access is denied" la pornire** → o alta instanta Electron ruleaza. Inchide toate (`taskkill /f /im electron.exe` sau Task Manager → `Legal Dashboard.exe`).
- **Hardware acceleration** → `ON` implicit pe Windows. Opt-out: `set ELECTRON_DISABLE_GPU=1 && npm start`.
- **Reset zoom Electron** → Ctrl+0 (zoom-ul persistat la `-0.5778` match PortalJust; reset explicit daca UI pare prea mic).
- **Captcha balance zero** → dialog "Setari AI" → card 2Captcha → buton "Verifica sold".
