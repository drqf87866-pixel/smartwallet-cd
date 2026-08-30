-- Migration 005: Budgets pro Kategorie
-- Anwenden: npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/005_budgets.sql
-- Neue/frische Installationen brauchen das nicht (schema.sql enthält alles).

-- month = 'default' gilt für alle Monate, solange kein monatsspezifischer
-- Eintrag (YYYY-MM) existiert; amount <= 0 bzw. Löschen = kein Budget.
CREATE TABLE IF NOT EXISTS budgets (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month        TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  amount       REAL    NOT NULL CHECK (amount > 0),
  PRIMARY KEY (household_id, month, category)
);
