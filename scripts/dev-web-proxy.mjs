#!/usr/bin/env node
// scripts/dev-web-proxy.mjs — mini-proxy local care simuleaza oauth2-proxy
// pentru testarea web mode-ului FARA infrastructura (Traefik + oauth2-proxy).
//
// Ce face, per request:
//   1. sterge header-ele de autentificare venite de la client (un browser nu
//      are voie sa-si aleaga singur identitatea);
//   2. injecteaza `Authorization: Basic base64(email:secret)` — mecanismul
//      real oauth2-proxy `--pass-basic-auth` + `--basic-auth-password`;
//   3. injecteaza `X-Forwarded-Email: <email>` — mecanismul real
//      `--pass-user-headers`;
//   4. forwardeaza catre backend-ul local si stream-uieste raspunsul inapoi.
//
// Motiv: SPA-ul isi minteaza singur sesiunea la bootstrap prin
// `POST /api/v1/auth/oauth2/sync`; fara aceste header-e injectate serverul
// raspunde 403 si UI-ul arata "Acces refuzat".
//
// Env consumate:
//   DEV_WEB_PROXY_SECRET         — REQUIRED; shared secret-ul bridge-ului
//                                  (LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET al backend-ului)
//   DEV_WEB_PROXY_EMAIL          — REQUIRED; identitatea simulata (emailul userului)
//   DEV_WEB_PROXY_PORT           — optional; portul de ascultare (default 3003)
//   DEV_WEB_PROXY_UPSTREAM_PORT  — optional; portul backend-ului (default 3002)
//
// DOAR pentru dev local: asculta exclusiv pe 127.0.0.1 si nu are TLS.

import http from "node:http";

function fail(message) {
  console.error(`[dev-web-proxy] ${message}`);
  process.exit(1);
}

const secret = (process.env.DEV_WEB_PROXY_SECRET ?? "").trim();
const email = (process.env.DEV_WEB_PROXY_EMAIL ?? "").trim();
const port = Number.parseInt(process.env.DEV_WEB_PROXY_PORT ?? "3003", 10);
const upstreamPort = Number.parseInt(process.env.DEV_WEB_PROXY_UPSTREAM_PORT ?? "3002", 10);

if (!secret) {
  fail("DEV_WEB_PROXY_SECRET lipseste — refuz sa pornesc un proxy care nu poate autentifica nimic.");
}
if (!email || !email.includes("@")) {
  fail("DEV_WEB_PROXY_EMAIL lipseste sau nu e un email — seteaza identitatea simulata explicit.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`DEV_WEB_PROXY_PORT invalid: ${process.env.DEV_WEB_PROXY_PORT}`);
}
if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
  fail(`DEV_WEB_PROXY_UPSTREAM_PORT invalid: ${process.env.DEV_WEB_PROXY_UPSTREAM_PORT}`);
}

// Header-ele pe care clientul nu are voie sa le controleze (identitate + secret),
// plus hop-by-hop headers care nu se forwardeaza. Fara `delete` (lint noDelete):
// obiectul de header-e se construieste prin filtrare.
const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "x-proxy-auth",
  "x-forwarded-email",
  "x-auth-request-email",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "connection",
  "keep-alive",
  "proxy-connection",
  "upgrade",
  "te",
  "trailer",
  // Framing-ul cererii il rescrie Node la pipe; un transfer-encoding copiat
  // de la client ar putea produce framing dublu pe body-uri chunked.
  "transfer-encoding",
]);

// Framing-ul raspunsului il gestioneaza Node (chunked automat la pipe);
// a copia transfer-encoding/connection de la upstream ar produce framing dublu.
const STRIPPED_RESPONSE_HEADERS = new Set(["transfer-encoding", "connection", "keep-alive"]);

const basicAuth = `Basic ${Buffer.from(`${email}:${secret}`).toString("base64")}`;

function buildUpstreamHeaders(reqHeaders) {
  const headers = {};
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value === undefined) continue;
    if (STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers[key] = value;
  }
  headers.authorization = basicAuth;
  headers["x-forwarded-email"] = email;
  headers["x-forwarded-proto"] = "https"; // simuleaza TLS-ul terminat la edge (patSecurity cere hint-ul)
  return headers;
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: buildUpstreamHeaders(req.headers),
    },
    (upstreamRes) => {
      // Guard: daca raspunsul catre client a fost deja abandonat, nu mai scriem.
      if (res.headersSent || res.writableEnded) {
        upstreamRes.destroy();
        return;
      }
      const responseHeaders = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
        if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
        responseHeaders[key] = value;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on("error", () => {
        // Upstream-ul a murit mid-stream: nu mai putem repara raspunsul, doar inchidem.
        res.destroy();
      });
    }
  );

  upstream.on("error", (err) => {
    console.error(`[dev-web-proxy] upstream error pe ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: null,
          error: { code: "proxy_upstream_error", message: "Backend-ul local nu raspunde." },
          requestId: null,
        })
      );
      return;
    }
    res.destroy();
  });

  req.pipe(upstream);
  req.on("error", () => upstream.destroy());
  res.on("error", () => upstream.destroy());
  res.on("close", () => {
    if (!res.writableEnded) upstream.destroy();
  });
});

server.on("clientError", (_err, socket) => {
  if (!socket.destroyed) socket.destroy();
});

// Backstop: o exceptie nesincronizata nu are voie sa lase proxy-ul intr-o stare
// zombie tacuta — logam si iesim, scriptul parinte raporteaza PID-ul.
process.on("uncaughtException", (err) => {
  console.error(`[dev-web-proxy] uncaughtException: ${err?.stack ?? err}`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[dev-web-proxy] ascult pe http://127.0.0.1:${port} -> backend 127.0.0.1:${upstreamPort} ca ${email}`);
});
