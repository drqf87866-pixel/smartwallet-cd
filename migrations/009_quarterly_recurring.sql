-- Migration 009: Vierteljährlicher Rhythmus für wiederkehrende Zahlungen
--
-- SQLite kann CHECK-Constraints nicht per ALTER ändern, daher wird recurring_rules
-- neu aufgebaut. transactions.recurring_id und recurring_skips.recurring_id
-- zeigen per FOREIGN KEY auf recurring_rules – D1 remote hat foreign_keys fest
-- auf ON (PRAGMA foreign_keys=OFF wird ignoriert) und verweigert ein DROP TABLE
-- auf recurring_rules, solange diese Referenzen bestehen ("FOREIGN KEY
-- constraint failed"), obwohl lokal (miniflare) unauffällig.
--
-- Reihenfolge daher: beide Kind-Tabellen zuerst OHNE die Referenz neu aufbauen,
-- dann recurring_rules neu aufbauen (jetzt unreferenziert → DROP erlaubt),
-- danach die Referenz in den Kind-Tabellen wiederherstellen (zeigt jetzt auf
-- die neue recurring_rules – gleiche IDs, also weiterhin gültig).
--
-- Nebenbei behoben: transactions.recurring_id hatte in schema.sql nie
-- "ON DELETE SET NULL", obwohl DELETE /api/recurring/:id (routes/recurring.ts)
-- genau das voraussetzt – dadurch schlug das Löschen einer Regel mit bereits
-- gebuchten Occurrences bislang mit einem FK-Fehler fehl. Wird hier beim
-- ohnehin nötigen Rebuild von transactions ergänzt.

-- 1) recurring_skips ohne FK auf recurring_rules neu aufbauen.
CREATE TABLE recurring_skips_tmp (
  recurring_id INTEGER NOT NULL,
  due_date     TEXT    NOT NULL,
  PRIMARY KEY (recurring_id, due_date)
);
INSERT INTO recurring_skips_tmp SELECT * FROM recurring_skips;
DROP TABLE recurring_skips;
ALTER TABLE recurring_skips_tmp RENAME TO recurring_skips;

-- 2) transactions ohne FK auf recurring_rules neu aufbauen (alle anderen
--    Spalten/Constraints unverändert übernommen).
CREATE TABLE transactions_tmp (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         REAL    NOT NULL CHECK (amount > 0),
  type           TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'settlement')),
  category       TEXT    NOT NULL DEFAULT 'Sonstiges',
  description    TEXT    NOT NULL DEFAULT '',
  date           TEXT    NOT NULL,
  scope          TEXT    NOT NULL CHECK (scope IN ('personal', 'shared')),
  paid_from      TEXT    NOT NULL DEFAULT 'joint' CHECK (paid_from IN ('private', 'joint')),
  counterpart_id INTEGER REFERENCES users(id),
  recurring_id   INTEGER
);
INSERT INTO transactions_tmp SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_tmp RENAME TO transactions;

-- 3) recurring_rules neu aufbauen – jetzt ohne aktive Kind-Referenzen möglich.
CREATE TABLE recurring_rules_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       REAL    NOT NULL CHECK (amount > 0),
  type         TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  category     TEXT    NOT NULL DEFAULT 'Sonstiges',
  description  TEXT    NOT NULL DEFAULT '',
  scope        TEXT    NOT NULL CHECK (scope IN ('personal', 'shared')),
  paid_from    TEXT    NOT NULL DEFAULT 'joint' CHECK (paid_from IN ('private', 'joint')),
  frequency    TEXT    NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  day          INTEGER NOT NULL,
  month        INTEGER,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO recurring_rules_new SELECT * FROM recurring_rules;
DROP TABLE recurring_rules;
ALTER TABLE recurring_rules_new RENAME TO recurring_rules;

CREATE INDEX IF NOT EXISTS idx_recurring_household ON recurring_rules(household_id);

-- 4) transactions erneut aufbauen – FK zurück auf die neue recurring_rules
--    (gleiche IDs wie vorher, weiterhin gültig), diesmal inkl. ON DELETE SET NULL.
CREATE TABLE transactions_final (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         REAL    NOT NULL CHECK (amount > 0),
  type           TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'settlement')),
  category       TEXT    NOT NULL DEFAULT 'Sonstiges',
  description    TEXT    NOT NULL DEFAULT '',
  date           TEXT    NOT NULL,
  scope          TEXT    NOT NULL CHECK (scope IN ('personal', 'shared')),
  paid_from      TEXT    NOT NULL DEFAULT 'joint' CHECK (paid_from IN ('private', 'joint')),
  counterpart_id INTEGER REFERENCES users(id),
  recurring_id   INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL
);
INSERT INTO transactions_final SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_final RENAME TO transactions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_recurring_occurrence ON transactions(recurring_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_scope ON transactions(scope);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);

-- 5) recurring_skips erneut aufbauen – FK zurück auf die neue recurring_rules.
CREATE TABLE recurring_skips_final (
  recurring_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date     TEXT    NOT NULL,
  PRIMARY KEY (recurring_id, due_date)
);
INSERT INTO recurring_skips_final SELECT * FROM recurring_skips;
DROP TABLE recurring_skips;
ALTER TABLE recurring_skips_final RENAME TO recurring_skips;
