-- Migration 004: Wiederkehrende Zahlungen
-- Anwenden: npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/004_recurring.sql
-- Neue/frische Installationen brauchen das nicht (schema.sql enthält alles).

-- Regeln: Rhythmus weekly (day = Wochentag 1-7, Mo=1), monthly (day = Tag 1-31,
-- klemmt auf den Monatsletzten), yearly (month = 1-12, day = Tag 1-31).
CREATE TABLE IF NOT EXISTS recurring_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       REAL    NOT NULL CHECK (amount > 0),
  type         TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  category     TEXT    NOT NULL DEFAULT 'Sonstiges',
  description  TEXT    NOT NULL DEFAULT '',
  scope        TEXT    NOT NULL CHECK (scope IN ('personal', 'shared')),
  paid_from    TEXT    NOT NULL DEFAULT 'joint' CHECK (paid_from IN ('private', 'joint')),
  frequency    TEXT    NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  day          INTEGER NOT NULL,
  month        INTEGER,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE transactions ADD COLUMN recurring_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL;

-- Dedupe-Schlüssel der Materialization: pro Regel und Fälligkeitsdatum existiert
-- jede Occurrence höchstens einmal (date = 'YYYY-MM-DDT12:00:00.000Z').
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_recurring_occurrence
  ON transactions(recurring_id, date);

-- Gelöschte/verschobene Occurrences: verhindert, dass die Materialization sie neu anlegt
CREATE TABLE IF NOT EXISTS recurring_skips (
  recurring_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date     TEXT    NOT NULL,
  PRIMARY KEY (recurring_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_household ON recurring_rules(household_id);
