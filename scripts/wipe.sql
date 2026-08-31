-- Leert alle Zeilen der D1-Datenbank, Schema/Indizes bleiben erhalten.
-- Verwendung: npm run db:wipe:local  bzw.  npm run db:wipe:remote
-- Reihenfolge beachtet Fremdschlüssel-Abhängigkeiten (Kinder vor Eltern).
DELETE FROM recurring_skips;
DELETE FROM transactions;
DELETE FROM recurring_rules;
DELETE FROM settings;
DELETE FROM users;
DELETE FROM households;
