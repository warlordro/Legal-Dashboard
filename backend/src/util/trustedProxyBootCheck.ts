import { getAuthMode } from "../auth/config.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// NEW-02 (strict): web mode on a loopback bind means a reverse proxy on the same
// host fronts the app — client requests then arrive with a loopback peer, and
// originGuard's loopback bypass becomes a total CSRF/rate-limit bypass unless
// TRUSTED_PROXY_CIDR is set. Fail closed. A direct non-loopback web bind keeps
// the real peer, so the CIDR stays optional there (handled by the boot warn).
export function assertTrustedProxyForWeb(env: NodeJS.ProcessEnv, hostname: string): void {
  if (getAuthMode(env) !== "web") return;
  if (!LOOPBACK_HOSTS.has(hostname)) return;
  if ((env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR ?? "").trim() !== "") return;
  throw new Error(
    "Web mode legat pe loopback (127.0.0.1) presupune un reverse proxy pe acelasi host. " +
      "Fara LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR, X-Forwarded-For e ignorat si originGuard " +
      "trateaza orice client venit prin proxy ca loopback (bypass CSRF). " +
      "Seteaza CIDR-ul retelei proxy-ului (ex. 127.0.0.1/32 pentru proxy co-locat). " +
      "Vezi DEPLOY-SERVER.md / RUNBOOK.md."
  );
}
