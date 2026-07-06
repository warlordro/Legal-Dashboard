-- v2.42.0: unicitatea emailului devine garantie de DB (case-insensitive).
-- Daca indexul nu se poate crea (dubluri istorice), migration-ul esueaza LOUD:
-- opereaza manual dublurile si reporneste. Pre-migration backup e automat.
CREATE UNIQUE INDEX idx_users_email_nocase ON users(email COLLATE NOCASE);
