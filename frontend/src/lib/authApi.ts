import { apiFetch, beginLogout } from "./api";

// Destinatia de dupa sign_out. Path RELATIV, obligatoriu: oauth2-proxy valideaza
// `rd` fata de OAUTH2_PROXY_WHITELIST_DOMAINS, iar un URL absolut catre alt
// domeniu e ignorat tacut si inlocuit cu "/" — de unde, cu SKIP_PROVIDER_BUTTON,
// Google re-logheaza instant utilizatorul si butonul pare ca nu face nimic.
// Verificat pe instanta reala: rd extern -> Location: /, rd relativ -> Location: /delogat.
const SIGN_OUT_URL = "/oauth2/sign_out?rd=%2Fdelogat";

/**
 * Inchide sesiunea web: revoca JWT-ul pe server, apoi paraseste aplicatia catre
 * sign_out-ul proxy-ului.
 *
 * Ordinea conteaza: POST-ul trebuie sa se termine inainte de navigare, altfel
 * revocarea si randul de audit se pierd. Esecul lui nu opreste redirectul — un
 * backend picat nu are voie sa tina utilizatorul logat.
 */
export async function logout(): Promise<void> {
  // Inainte de orice cerere: opreste re-mint-ul si asteapta sync-ul deja pornit,
  // ca revocarea sa prinda jti-ul cookie-ului chiar activ (vezi api.ts).
  await beginLogout();
  try {
    const res = await apiFetch("/api/v1/auth/logout", { method: "POST" });
    // fetch nu arunca pe 4xx/5xx: fara verificarea asta, un logout respins de
    // server ar trece drept reusit si nu ar ramane nicio urma client-side.
    if (!res.ok) {
      console.error(`[auth] logout respins de server (HTTP ${res.status}); continui cu delogarea locala`);
    }
  } catch (err) {
    console.error("[auth] logout request failed, continui cu delogarea locala:", err);
  }
  window.location.assign(SIGN_OUT_URL);
}
