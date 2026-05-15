import type { Hono } from "hono";
import fsPromises from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Mount SPA static file serving with path-traversal protection.
// `baseDir` must be an absolute or resolvable path to the frontend build output.
export function mountStaticFrontend(app: Hono, baseDir: string): void {
  let frontendPath = baseDir;
  // In Electron packaged app, asarUnpack extracts to app.asar.unpacked
  const unpackedPath = frontendPath.replace("app.asar", "app.asar.unpacked");
  if (fs.existsSync(unpackedPath)) {
    frontendPath = unpackedPath;
  }

  const resolvedFrontend = path.resolve(frontendPath);

  app.get("/*", async (c) => {
    const urlPath = c.req.path;
    // API / health paths must never fall through to the SPA fallback. If we
    // reached this handler it means no /api router matched — surface a proper
    // 404 with JSON so the client doesn't try to JSON.parse an HTML index page
    // (which manifested as "Raspuns invalid de la server" + a Hono "Context
    // is not finalized" error in the log).
    if (urlPath.startsWith("/api/") || urlPath === "/health") {
      return c.json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    // Decode and resolve the requested file path
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(urlPath);
    } catch {
      return c.text("Bad Request", 400);
    }
    const filePath = path.resolve(resolvedFrontend, decodedPath === "/" ? "index.html" : "." + decodedPath);

    // SECURITY: Prevent path traversal. startsWith() is a textual prefix check —
    // a sibling dir like `frontend-evil/` shares the prefix and passes incorrectly.
    // path.relative() handles separators, case (Windows), and returns "../…" when
    // the target escapes the base dir.
    const rel = path.relative(resolvedFrontend, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return c.text("Forbidden", 403);
    }

    try {
      const content = await fsPromises.readFile(filePath);
      const ext = path.extname(filePath);
      const mime = mimeTypes[ext] || "application/octet-stream";
      return c.body(content, 200, { "Content-Type": mime });
    } catch {
      // SPA fallback
      const html = await fsPromises.readFile(path.join(resolvedFrontend, "index.html"), "utf-8");
      return c.html(html);
    }
  });
}
