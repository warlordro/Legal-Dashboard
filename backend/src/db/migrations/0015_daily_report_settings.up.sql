-- 0015_daily_report_settings.up.sql - per-owner daily email digest preferences (v2.13.0).
--
-- daily_report_enabled (DEFAULT 0): existing per-alert email channel ramane
-- separat. Daily digest este un canal complementar care recolteaza toate
-- alertele din ziua precedenta intr-un singur email (recap), util pentru
-- useri care vor o privire de ansamblu fara sa filtreze inbox-ul SMTP per-alerta.
--
-- last_daily_report_sent_for (TEXT, format YYYY-MM-DD ora locala): dedup la
-- restart si idempotency. Scheduler-ul itereaza la fiecare 5 minute si trimite
-- doar daca data curenta locala difera de aceasta valoare AND ora curenta
-- locala matcheaza configul global DAILY_REPORT_HOUR.
--
-- Ora trimiterii ramane configurata global via env DAILY_REPORT_HOUR (default
-- 9, ora locala server). UI-ul expune in v2.13.0 doar toggle on/off; ora
-- per-owner devine configurabila in versiuni viitoare cand modul web este in
-- productie cu useri multipli in TZ diferite.

ALTER TABLE owner_email_settings
  ADD COLUMN daily_report_enabled INTEGER NOT NULL DEFAULT 0
    CHECK(daily_report_enabled IN (0,1));

ALTER TABLE owner_email_settings
  ADD COLUMN last_daily_report_sent_for TEXT;
