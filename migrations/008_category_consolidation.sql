-- Kategorien auf 5 Ausgaben-Hauptkategorien reduzieren; Einnahmen vereinheitlichen.
-- System-Kategorien (Beitrag, Überweisung, Ausgleich) bleiben unverändert.

-- Ausgaben: Wohnen
UPDATE transactions SET category = 'Wohnen'
WHERE type = 'expense' AND category IN ('Miete', 'Strom', 'Internet', 'Haushalt');

UPDATE recurring_rules SET category = 'Wohnen'
WHERE type = 'expense' AND category IN ('Miete', 'Strom', 'Internet', 'Haushalt');

-- Ausgaben: Essen & Trinken
UPDATE transactions SET category = 'Essen & Trinken'
WHERE type = 'expense' AND category IN ('Lebensmittel', 'Restaurant', 'Café');

UPDATE recurring_rules SET category = 'Essen & Trinken'
WHERE type = 'expense' AND category IN ('Lebensmittel', 'Restaurant', 'Café');

-- Ausgaben: Mobilität
UPDATE transactions SET category = 'Mobilität'
WHERE type = 'expense' AND category IN ('Transport', 'Tanken');

UPDATE recurring_rules SET category = 'Mobilität'
WHERE type = 'expense' AND category IN ('Transport', 'Tanken');

-- Ausgaben: Gesundheit & Körper
UPDATE transactions SET category = 'Gesundheit & Körper'
WHERE type = 'expense' AND category IN ('Drogerie', 'Gesundheit', 'Kleidung', 'Sport');

UPDATE recurring_rules SET category = 'Gesundheit & Körper'
WHERE type = 'expense' AND category IN ('Drogerie', 'Gesundheit', 'Kleidung', 'Sport');

-- Ausgaben: Freizeit & Sonstiges
UPDATE transactions SET category = 'Freizeit & Sonstiges'
WHERE type = 'expense' AND category IN ('Streaming', 'Freizeit', 'Urlaub', 'Geschenke', 'Bildung', 'Versicherung', 'Sonstiges');

UPDATE recurring_rules SET category = 'Freizeit & Sonstiges'
WHERE type = 'expense' AND category IN ('Streaming', 'Freizeit', 'Urlaub', 'Geschenke', 'Bildung', 'Versicherung', 'Sonstiges');

-- Einnahmen: feste Kategorie
UPDATE transactions SET category = 'Einnahme'
WHERE type = 'income';

UPDATE recurring_rules SET category = 'Einnahme'
WHERE type = 'income';
