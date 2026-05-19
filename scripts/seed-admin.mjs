#!/usr/bin/env node
// scripts/seed-admin.mjs — provisioneaza adminul initial dupa primul deploy
// pe server (v2.31.0). Idempotent: nu mai face nimic daca emailul exista
// deja cu rol admin si status active.
//
// Folosire (inauntrul containerului `backend`):
//   docker compose exec backend node scripts/seed-admin.mjs
//
// Env consumate:
//   SEED_ADMIN_EMAIL          — REQUIRED, emailul Google al primului admin
//   SEED_ADMIN_DISPLAY_NAME   — REQUIRED, numele afisat in /admin/users
//   LEGAL_DASHBOARD_DB_PATH   — optional, default /data/legal-dashboard.db
//
// Output (stdout): linie de tip
//   {"action":"created","userId":"...","email":"..."}
// sau
//   {"action":"already_admin","userId":"...","email":"..."}
//
// Exit code: 0 succes/idempotent, 1 invalid args, 2 conflict de rol (email
// exista dar nu e admin — escaladare manuala).

import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fail(message, code = 1) {
  console.error(`[seed-admin] ${message}`);
  process.exit(code);
}

function readArgs() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const displayName = (process.env.SEED_ADMIN_DISPLAY_NAME ?? "").trim();
  if (!email || !email.includes("@")) {
    fail("SEED_ADMIN_EMAIL invalid sau lipsa.");
  }
  if (!displayName) {
    fail("SEED_ADMIN_DISPLAY_NAME lipsa.");
  }
  return { email, displayName };
}

function resolveDbPath() {
  if (process.env.LEGAL_DASHBOARD_DB_PATH) {
    return process.env.LEGAL_DASHBOARD_DB_PATH;
  }
  // Default container path; aligns with deploy/docker-compose.prod.yml.
  return "/data/legal-dashboard.db";
}

async function loadBetterSqlite() {
  try {
    const mod = await import("better-sqlite3");
    return mod.default;
  } catch (err) {
    fail(`better-sqlite3 indisponibil. Ruleaza scriptul in container: ${err?.message ?? err}`);
  }
}

async function main() {
  const { email, displayName } = readArgs();
  const dbPath = resolveDbPath();

  const Database = await loadBetterSqlite();
  const db = new Database(dbPath, { fileMustExist: false });

  // Schema migrations ruleaza la primul boot al backend-ului. Daca scriptul e
  // chemat inainte ca backend-ul sa fi pornit vreodata, tabela `users` nu
  // exista. Verificam si oprim cu un mesaj actionabil.
  const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!tableInfo) {
    db.close();
    fail(
      "Tabela `users` lipseste. Porneste backend-ul cel putin o data (docker compose up -d backend) inainte de seed."
    );
  }

  const existing = db.prepare("SELECT id, role, status FROM users WHERE email = ?").get(email);
  if (existing) {
    if (existing.role === "admin" && existing.status === "active") {
      console.log(JSON.stringify({ action: "already_admin", userId: existing.id, email }));
      db.close();
      return;
    }
    db.close();
    fail(
      `Email-ul "${email}" exista cu role=${existing.role} status=${existing.status}. Promovare manuala necesara (UI /admin/users sau SQL direct).`,
      2
    );
  }

  const userId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, email, null, displayName, "admin", "active");
  console.log(JSON.stringify({ action: "created", userId, email }));
  db.close();
}

main().catch((err) => {
  fail(err?.stack ?? err?.message ?? String(err));
});
