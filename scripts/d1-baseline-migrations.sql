-- Markiert Schema-Migrationen als angewendet, wenn die DB per schema.sql
-- (npm run db:init) angelegt wurde statt schrittweise migriert.
-- Idempotent: INSERT OR IGNORE – sicher mehrfach ausführbar.
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('002_households.sql'),
  ('003_monthly_contribution.sql'),
  ('004_recurring.sql'),
  ('006_perf_indexes.sql'),
  ('007_drop_budgets.sql');
