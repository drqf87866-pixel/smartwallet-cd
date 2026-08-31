-- SmartWallet – D1 Schema
-- Anwenden mit: npm run db:init   (lokal)
--           bzw: npm run db:init:remote   (produktive D1)
-- Kompletter Reset (lokal, löscht Daten!): npm run db:reset
-- Migration bestehender Instanzen: migrations/002_households.sql,
-- migrations/003_monthly_contribution.sql, migrations/004_recurring.sql

-- Haushalte: Registrierung erstellt einen neuen Haushalt oder tritt per
-- Einladungscode einem bestehenden bei (beliebig viele Mitglieder).
CREATE TABLE IF NOT EXISTS households (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type:      income    = Geld geht auf das Konto in paid_from
--            expense   = Geld verlässt das Konto in paid_from
--            transfer  = Monatsbeitrag: verlässt das Privatkonto von user_id,
--                        landet auf dem Gemeinschaftskonto
--            settlement = Ausgleichszahlung: von user_id an counterpart_id
--                        (beide Privatkonto)
-- paid_from: Konto, über das abgewickelt wurde ('private' | 'joint')
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0, -- Haushaltsgründer
  monthly_contribution REAL NOT NULL DEFAULT 0 -- eigener Monatsbeitrag des Mitglieds
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        REAL    NOT NULL CHECK (amount > 0),
  type          TEXT    NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'settlement')),
  category      TEXT    NOT NULL DEFAULT 'Sonstiges',
  description   TEXT    NOT NULL DEFAULT '',
  date          TEXT    NOT NULL, -- ISO 8601 (UTC), z. B. '2026-08-29T14:30:00.000Z'
  scope         TEXT    NOT NULL CHECK (scope IN ('personal', 'shared')),
  paid_from     TEXT    NOT NULL DEFAULT 'joint' CHECK (paid_from IN ('private', 'joint')),
  counterpart_id INTEGER REFERENCES users(id), -- nur type='settlement': Empfänger
  recurring_id   INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL -- gesetzt bei aus Regeln erzeugten Occurrences
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_recurring_occurrence
  ON transactions(recurring_id, date);

CREATE INDEX IF NOT EXISTS idx_transactions_user  ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date  ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_scope ON transactions(scope);
CREATE INDEX IF NOT EXISTS idx_users_household    ON users(household_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);

-- Wiederkehrende Zahlungen: Rhythmus weekly (day = Wochentag 1-7, Mo=1),
-- monthly (day = Tag 1-31, klemmt auf Monatsletzten), quarterly (day = Tag,
-- month = Startmonat 1-12 als Anker für den 3-Monats-Rhythmus),
-- yearly (month 1-12 + day).
-- Fällige Occurrences werden beim Dashboard-Laden (Lazy Materialization) bzw.
-- vom täglichen Cron als normale Transaktionen erzeugt; gelöschte Occurrences
-- landen in recurring_skips, damit sie nicht neu angelegt werden.
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
  frequency    TEXT    NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  day          INTEGER NOT NULL,
  month        INTEGER,
  start_date   TEXT    NOT NULL,
  end_date     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_skips (
  recurring_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date     TEXT    NOT NULL,
  PRIMARY KEY (recurring_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_recurring_household ON recurring_rules(household_id);

-- Schlüssel-Werte-Speicher pro Haushalt:
--   joint_start_balance = Startstand des Gemeinschaftskontos (Zahl als TEXT)
--   joint_contribution  = Fixbetrag pro Person/Monat (Zahl als TEXT)
CREATE TABLE IF NOT EXISTS settings (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
);
