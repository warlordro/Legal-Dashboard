# Plan: buton de delogare in modul web

Revizuit dupa review-ul fable-advisor si dupa verificare empirica pe instanta
reala. Designul initial (redirect `rd` catre un domeniu extern) a fost eliminat:
e respins determinist de configuratia deja deploiata.

## Problema

Interfata nu are niciun control de delogare. Backend-ul expune deja
`POST /api/v1/auth/logout` (revoca `jti` in denylist, scrie audit cu IP, sterge
cookie-ul `legal_dashboard_session`), dar frontend-ul nu il apeleaza niciodata.
Pe desktop nu conta: un singur utilizator local. De cand aplicatia e publica,
un utilizator nu poate incheia sesiunea de pe un calculator strain decat
stergand manual cookie-urile.

## Constrangeri, toate verificate

1. **Doua cookie-uri.** `legal_dashboard_session` (JWT, 1h) e al backend-ului;
   `_oauth2_proxy` (168h) e al proxy-ului. Stergerea doar a primului nu
   deconecteaza: bridge-ul `/oauth2/sync` reface sesiunea tacut.

2. **`apiFetch` re-minteste sesiunea la 401** (`frontend/src/lib/api.ts:83-90`).
   Rutele de auth sunt excluse prin `isAuthPath`, deci apelul de logout e sigur,
   dar orice cerere concurenta in zbor (SSE, fetch de pagina) primeste 401 dupa
   revocarea jti-ului si declanseaza un re-mint. Rezultat: un JWT nou, valid,
   emis chiar in timpul delogarii si nesters de `sign_out` (care atinge doar
   cookie-ul proxy-ului).

3. **`rd` extern e respins.** Verificat live:
   `GET /oauth2/sign_out?rd=https%3A%2F%2Fexample.com` -> `Location: /`;
   `GET /oauth2/sign_out?rd=%2Fdelogat` -> `Location: /delogat`.
   Cauza: `OAUTH2_PROXY_WHITELIST_DOMAINS=.${DOMAIN}`. Path-urile relative trec
   intotdeauna.

4. **Fallback-ul SPA inghite rutele necunoscute**
   (`backend/src/middleware/static-frontend.ts:73-77`): orice GET nerezolvat
   serveste `index.html`. Iar `App.tsx:512-514` randeaza aplicatia autentificata
   si pe status `"error"`. Deci o "pagina de delogare" servita prin SPA ar arata
   ca aplicatia logata, plina de erori. Pagina trebuie servita de o ruta proprie,
   inregistrata inainte de `mountStaticFrontend` (`backend/src/index.ts:491`).

5. **`SKIP_PROVIDER_BUTTON=true`**: revenirea pe o ruta protejata sare direct la
   Google, iar cu sesiunea Google inca vie utilizatorul e re-logat instant. Nu e
   o regresie de securitate — cookie-ul proxy chiar a fost sters — dar inseamna
   ca delogarea din aplicatie NU protejeaza pe un calculator strain. Avertismentul
   trebuie sa fie vizibil pe pagina, nu ascuns intr-un `title`.

## Implementare

### 1. Backend: `GET /delogat`

In `backend/src/index.ts`, inainte de `mountStaticFrontend`:

- HTML standalone inline, fara asset-uri (ca sa nu depinda de SPA).
- Continut: "Ai fost delogat", link "Autentificare din nou" catre `/`, si
  avertismentul vizibil: pe un calculator strain, delogheaza-te si din contul
  Google, cu link catre `https://accounts.google.com/Logout`.
- Raspunsul sterge si cookie-ul `legal_dashboard_session` — a doua linie de
  aparare pentru cursa din constrangerea 2.
- `Cache-Control: no-store`.

### 2. Compose: ruta publica

`deploy/docker-compose.nas.yml`: `OAUTH2_PROXY_SKIP_AUTH_ROUTES` primeste
`GET=^/delogat$$` (dublu `$` obligatoriu, ca la intrarile existente).
Necesita recrearea containerului oauth2-proxy, nu doar rebuild de backend.

### 3. Frontend: `lib/authApi.ts` (nou)

```
export async function logout(): Promise<void>
```

- Seteaza flagul de modul `beginLogout()` din `api.ts` inainte de orice cerere.
- `POST /api/v1/auth/logout` prin `apiFetch`. Esecul nu opreste fluxul: se
  logheaza si se continua, altfel un backend picat ar bloca utilizatorul logat.
- `window.location.assign("/oauth2/sign_out?rd=%2Fdelogat")` — full page load,
  care taie orice cerere in zbor.

### 4. Frontend: `lib/api.ts`

Flag `logoutInProgress` + `beginLogout()`, consultat in ramura de 401: cat timp
e activ, nu se mai face re-mint. Inchide cursa din constrangerea 2.

### 5. Frontend: `components/sidebar-footer.tsx`

Buton nou doar cand `isWeb`, plasat inaintea comutatorului de meniu. Icon
`LogOut`, eticheta "Delogare", varianta `ghost`; in modul collapsed doar iconita
cu `title`. Fara dialog de confirmare.

### 6. Teste

`frontend/src/lib/authApi.test.ts`:
- apeleaza `POST /api/v1/auth/logout`;
- redirecteaza catre `/oauth2/sign_out?rd=%2Fdelogat` si cand POST-ul esueaza;
- POST-ul se termina inaintea redirectului (ordinea conteaza pentru audit);
- `beginLogout()` e apelat inainte de POST.

`frontend/src/lib/api.test.ts` (extindere): dupa `beginLogout()`, un 401 nu mai
declanseaza `ensureWebSession`.

`frontend/src/components/sidebar-footer.test.tsx` (fisier nou — nu exista):
butonul apare in web, lipseste pe desktop.

## Ce NU intra

- Delogarea din contul Google: nu o putem forta fara sa afectam alte aplicatii
  ale utilizatorului. Se semnaleaza vizibil pe pagina `/delogat`, cu link.
- Invalidarea sesiunilor de pe alte dispozitive: exista deja prin rotirea
  `JWT_SECRET`; un ecran de sesiuni active e alt task.
- Bump-ul de versiune al proiectului: decizie de release, nu de implementare.

## Corectii dupa review-ul advers post-implementare

Codex a gasit o cursa pe care primul review o ratase, plus lacune in teste:

- **`beginLogout()` nu oprea un sync deja pornit.** Flagul impiedica doar
  pornirea unuia nou; unul aflat in zbor isi scrie cookie-ul cand aterizeaza,
  posibil dupa stergerea din `/delogat`. Acum `beginLogout()` e async si asteapta
  `reSyncInFlight`, deci POST-ul de logout revoca exact jti-ul cookie-ului activ.
- **Raspunsurile non-2xx erau tratate ca succes.** `fetch` nu arunca pe 403/429/500;
  `logout()` verifica acum `res.ok` si logheaza statusul.
- **Ruta a fost extrasa** in `backend/src/routes/logoutPage.ts`, ca sa poata fi
  testata fara sa porneasca aplicatia intreaga (baza, scheduler, migrari).
- **Teste adaugate**: 6 pe ruta de backend (stergerea cookie-ului cu atributele
  corecte in web si desktop, `no-store`, continut static neinfluentat de query),
  unul de concurenta care tine sync-ul deschis (verificat ca pica fara fix), si
  cazurile 403/429/500 si collapsed.
- **Logout-CSRF prin GET public**: acceptat deliberat si documentat in modul.
  Un site extern poate forta o delogare prin navigare — sacaiala, nu escaladare.
  Alternativa (POST cu token CSRF) ar cere JavaScript pe o pagina care trebuie sa
  functioneze tocmai cand sesiunea nu mai exista.

## Verificare

1. `npx biome check --write` pe fisierele atinse.
2. `npx tsc --noEmit -p backend/tsconfig.json` si `cd frontend && npx tsc --noEmit`.
3. Testele noi + cele existente pe fisierele atinse.
4. `npm run build`.
5. Pe NAS: `APP_VERSION` incrementat + Build pentru backend, si recrearea
   containerului oauth2-proxy pentru `SKIP_AUTH_ROUTES`.
6. Manual: `curl -I https://dashboard.rodatagovt.com/delogat` neautentificat
   trebuie sa intoarca `200`, nu redirect catre Google. Apoi click pe Delogare
   in aplicatie: aterizare pe `/delogat`, si un rand `auth.logout` cu IP real in
   Setari -> Audit.

   Asteptarea corecta NU e "mi se cere login la revenire": cu sesiunea Google
   activa, revenirea pe `/` re-autentifica silentios. Verificarea reala e ca ai
   aterizat pe `/delogat` si ca auditul a inregistrat delogarea.
