// scripts/dev-web-proxy.mjs — mini-proxy local care simuleaza oauth2-proxy.
//
// In productie oauth2-proxy injecteaza pe FIECARE request upstream secretul
// comun (Authorization: Basic base64(user:secret)) si identitatea userului
// (X-Forwarded-Email). SPA-ul se bazeaza pe asta la bootstrap: POST
// /api/v1/auth/oauth2/sync din browser primeste header-ele de la proxy, nu de
// la client. Local, fara acest proxy, bridge-ul refuza 403 si aplicatia arata
// "Acces refuzat" inainte sa se uite la cookie.
//
// Usage (env setat de scripts/dev-web-local.ps1 sau manual):
//   DEV_WEB_PROXY_SECRET=<secret> DEV_WEB_PROXY_EMAIL=<email> \
//   node scripts/dev-web-proxy.mjs [listenPort=3003] [upstreamPort=3002]
//
// Dev-only: nu folosi niciodata in productie — nu face autentificare reala.

import http from "node:http";

const listenPort = Number(process.argv[2] ?? 3003);
const upstreamPort = Number(process.argv[3] ?? 3002);
const secret = process.env.DEV_WEB_PROXY_SECRET ?? "";
const email = process.env.DEV_WEB_PROXY_EMAIL ?? "";

if (!secret || !email) {
  console.error("[dev-web-proxy] DEV_WEB_PROXY_SECRET si DEV_WEB_PROXY_EMAIL sunt obligatorii.");
  process.exit(1);
}

const basic = Buffer.from(`oauth2:${secret}`, "utf8").toString("base64");

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  // Simuleaza Caddy: header-ele de identitate venite de la client se arunca —
  // doar proxy-ul are voie sa le seteze.
  delete headers.authorization;
  delete headers["x-forwarded-email"];
  delete headers["x-auth-request-email"];
  delete headers["x-proxy-auth"];
  // Simuleaza oauth2-proxy: secret + identitate pe fiecare request upstream.
  headers.authorization = `Basic ${basic}`;
  headers["x-forwarded-email"] = email;
  headers.host = `127.0.0.1:${upstreamPort}`;

  const upstream = http.request(
    { host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res); // streaming pass-through (inclusiv SSE)
    }
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`dev-web-proxy: upstream indisponibil (${err.message})`);
  });
  req.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`[dev-web-proxy] http://127.0.0.1:${listenPort} -> 127.0.0.1:${upstreamPort} (identitate: ${email})`);
});
