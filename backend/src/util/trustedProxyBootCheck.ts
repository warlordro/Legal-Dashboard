import { getAuthMode } from "../auth/config.ts";
import { findUnsupportedTrustedCidrEntries, hasSupportedTrustedCidr, isLoopbackHostname } from "./proxyIp.ts";

// NEW-02 (strict): web mode on a loopback bind means a reverse proxy on the same
// host fronts the app — client requests then arrive with a loopback peer, and
// originGuard's loopback bypass becomes a total CSRF/rate-limit bypass unless
// TRUSTED_PROXY_CIDR is set. Fail closed. A direct non-loopback web bind keeps
// the real peer, so the CIDR stays optional there (handled by the boot warn).
//
// Loopback bind detection (isLoopbackHostname) and CIDR validity
// (hasSupportedTrustedCidr) both reuse the parser in proxyIp.ts so this gate can
// never diverge from runtime: any 127.0.0.0/8 / expanded ::1 / ::ffff:127.x bind
// triggers it, and a CIDR that is empty OR made only of entries the parser
// ignores (garbage, IPv6 non-/128, `127.0.0.1/` with an empty prefix) is treated
// as "no protection" and fails boot.
export function assertTrustedProxyForWeb(env: NodeJS.ProcessEnv, hostname: string): void {
  if (getAuthMode(env) !== "web") return;
  if (!isLoopbackHostname(hostname)) return;
  const raw = env.LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR ?? "";
  if (hasSupportedTrustedCidr(raw)) return;
  const unsupported = findUnsupportedTrustedCidrEntries(raw);
  const detail =
    unsupported.length > 0
      ? `Intrarile configurate sunt nesuportate de parser si ignorate la matching: ${unsupported.join(", ")}. `
      : "";
  throw new Error(
    "Web mode legat pe loopback (127.0.0.0/8, ::1) presupune un reverse proxy pe acelasi host. " +
      "Fara un LEGAL_DASHBOARD_TRUSTED_PROXY_CIDR valid, X-Forwarded-For e ignorat si originGuard " +
      "trateaza orice client venit prin proxy ca loopback (bypass CSRF). " +
      detail +
      "Seteaza cel putin un CIDR suportat de parser (ex. 127.0.0.1/32 pentru proxy co-locat). " +
      "Vezi DEPLOY-SERVER.md / RUNBOOK.md."
  );
}
