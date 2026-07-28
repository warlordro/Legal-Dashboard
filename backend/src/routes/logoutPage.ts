import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { AUTH_COOKIE_NAME } from "../auth/authProvider.ts";
import { getAuthMode } from "../auth/config.ts";

// Pagina de aterizare dupa `/oauth2/sign_out`.
//
// Se monteaza INAINTE de mountStaticFrontend: fallback-ul SPA raspunde la orice
// GET necunoscut cu index.html, iar App.tsx randeaza aplicatia autentificata si
// pe status "error" — utilizatorul ar vedea shell-ul logat, plin de erori, exact
// pe pagina care ar trebui sa confirme delogarea.
//
// Ruta e publica (in oauth2-proxy e trecuta in SKIP_AUTH_ROUTES); gate-uita, ar
// re-declansa login-ul Google si bucla ar fi invizibila pentru utilizator.
// Compromis acceptat: fiind un GET public care sterge un cookie, un site extern
// poate forta o delogare prin navigare. E sacaiala, nu escaladare - nu expune
// date si nu ofera acces. Alternativa (POST cu token CSRF) ar cere JavaScript pe
// o pagina care trebuie sa functioneze exact cand sesiunea nu mai exista.
//
// HTML inline, fara asset-uri, ca pagina sa nu depinda de nimic din SPA.
const PAGE = `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delogat - Legal Dashboard</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#f5f6f8; color:#131a23;
         font-family:system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:32rem; padding:2rem 1.5rem; text-align:center; }
  h1 { font-size:1.4rem; margin:0 0 .75rem; }
  p { margin:0 0 1rem; line-height:1.6; color:#55606f; }
  .warn { background:#fff; border:1px solid #dce1e9; border-left:3px solid #a83028;
          border-radius:3px; padding:.9rem 1rem; text-align:left; font-size:.93rem; }
  a { color:#2d5f7c; }
  .btn { display:inline-block; margin-top:1.25rem; padding:.55rem 1.1rem;
         background:#2d5f7c; color:#fff; border-radius:3px; text-decoration:none; }
  @media (prefers-color-scheme: dark) {
    body { background:#0d1219; color:#e7ebf1; }
    p { color:#9aa5b4; }
    .warn { background:#151d27; border-color:#253040; }
    a { color:#85b8d6; }
  }
</style>
</head>
<body>
<main>
  <h1>Ai fost delogat</h1>
  <p>Sesiunea din Legal Dashboard a fost inchisa.</p>
  <p class="warn"><strong>Pe un calculator strain nu e suficient.</strong>
     Contul tau Google a ramas conectat in acest browser, iar o revenire pe
     aplicatie te va autentifica din nou automat. Delogheaza-te si din
     <a href="https://accounts.google.com/Logout" rel="noopener noreferrer">contul Google</a>.</p>
  <a class="btn" href="/">Autentificare din nou</a>
</main>
</body>
</html>`;

export const logoutPageRouter = new Hono();

logoutPageRouter.get("/delogat", (c) => {
  // A doua linie de aparare pentru cursa de la logout: daca o cerere in zbor a
  // apucat sa re-minteasca un JWT, `sign_out` nu l-ar sterge (el atinge doar
  // cookie-ul proxy-ului). Aceleasi optiuni ca la /auth/logout - atributele nu
  // fac parte din identitatea cookie-ului, dar divergenta ar ridica intrebari
  // la fiecare review.
  deleteCookie(c, AUTH_COOKIE_NAME, {
    secure: getAuthMode() === "web",
    sameSite: "Strict",
    path: "/",
  });
  c.header("Cache-Control", "no-store");
  return c.html(PAGE);
});
