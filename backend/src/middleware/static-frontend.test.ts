// Fix CodeRabbit C4: politica de cache se decidea pe decodedPath BRUT, dar
// rezolvarea fisierului e normalizata — "/assets/..%2Findex.html" ramane in
// base (trece de guard-ul de traversal) si servea index.html cu
// "public, max-age=31536000, immutable" (index vechi dupa rebuild, cache-uibil
// si de Cloudflare pe URL-ul exact). Politica trebuie sa se bazeze pe path-ul
// RELATIV normalizat (rel), nu pe stringul cerut.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountStaticFrontend } from "./static-frontend.ts";

let tmpDir: string;
let app: Hono;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "static-fe-"));
  fs.writeFileSync(path.join(tmpDir, "index.html"), "<html>index</html>");
  fs.mkdirSync(path.join(tmpDir, "assets"));
  fs.writeFileSync(path.join(tmpDir, "assets", "app-abc123.js"), "console.log(1)");
  app = new Hono();
  mountStaticFrontend(app, tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("static-frontend — politica de cache pe path-ul normalizat (C4)", () => {
  it("asset real din /assets/ primeste immutable", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("index.html primeste no-cache", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("traversal encodat sub /assets/ NU primeste immutable pe index.html", async () => {
    // %2F ramane encodat in pathname (URL nu-l normalizeaza ca separator);
    // decodeURIComponent din middleware il transforma in "/", deci fisierul
    // rezolvat e index.html — politica trebuie sa urmeze FISIERUL, nu URL-ul.
    const res = await app.request("/assets/..%2Findex.html");
    if (res.status === 200) {
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
    } else {
      // Alternativ acceptabil: cererea e refuzata complet (403/400).
      expect([400, 403, 404]).toContain(res.status);
    }
  });

  it("dot-segments necodate sunt normalizate inainte de handler (sanity)", async () => {
    const res = await app.request("/assets/../index.html");
    if (res.status === 200) {
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
    } else {
      expect([400, 403, 404]).toContain(res.status);
    }
  });
});
