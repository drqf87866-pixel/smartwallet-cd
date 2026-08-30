-- Migration 003: Eigener Monatsbeitrag pro Mitglied (ersetzt den haushaltsweiten Fixbetrag)
-- Anwenden: npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/003_monthly_contribution.sql
-- Neue/frische Installationen brauchen das nicht (schema.sql enthält alles).

ALTER TABLE users ADD COLUMN monthly_contribution REAL NOT NULL DEFAULT 0;

-- Bisherigen haushaltsweiten Fixbetrag einmalig auf alle Mitglieder übernehmen
UPDATE users
  SET monthly_contribution = COALESCE(
    (
      SELECT CAST(value AS REAL) FROM settings
      WHERE settings.household_id = users.household_id AND settings.key = 'joint_contribution'
    ),
    0
  );
