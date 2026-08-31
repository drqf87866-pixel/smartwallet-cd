-- Migration 007: Budget-Funktion entfernt
-- Anwenden: npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/007_drop_budgets.sql
DROP TABLE IF EXISTS budgets;
