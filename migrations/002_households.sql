-- Migration 002: Haushalte & Einladungscodes (für bestehende produktive D1)
-- Anwenden: npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/002_households.sql
-- Neue/frische Installationen brauchen das nicht (schema.sql enthält alles).

CREATE TABLE IF NOT EXISTS households (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE users ADD COLUMN household_id INTEGER REFERENCES households(id);
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Bestehende Nutzer in einen Standard-Haushalt übernehmen
INSERT INTO households (name, invite_code)
  SELECT 'Mein Haushalt', UPPER(HEX(RANDOMBLOB(4)))
  WHERE NOT EXISTS (SELECT 1 FROM households);

UPDATE users
  SET household_id = (SELECT id FROM households ORDER BY id LIMIT 1)
  WHERE household_id IS NULL;

-- Settings auf Haushalts-Scope umstellen (Rebuild)
CREATE TABLE settings_new (
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
);
INSERT INTO settings_new
  SELECT (SELECT MIN(id) FROM households), key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- Ausgleichszahlungen: expliziter Empfänger
ALTER TABLE transactions ADD COLUMN counterpart_id INTEGER REFERENCES users(id);
