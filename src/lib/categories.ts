/** Standard-Kategorien des Haushaltsbuchs – Grundlage für Magic Input, Dropdown und Budgets. */

export const EXPENSE_CATEGORIES = [
  'Lebensmittel',
  'Restaurant',
  'Café',
  'Miete',
  'Strom',
  'Internet',
  'Streaming',
  'Haushalt',
  'Drogerie',
  'Gesundheit',
  'Kleidung',
  'Freizeit',
  'Sport',
  'Transport',
  'Tanken',
  'Urlaub',
  'Geschenke',
  'Bildung',
  'Versicherung',
  'Sonstiges',
] as const;

export const INCOME_CATEGORIES = [
  'Gehalt',
  'Nebeneinkünfte',
  'Verkauf',
  'Erstattung',
  'Geschenk',
  'Sonstiges',
] as const;

/** Alle Kategorien, die der Magic Input (Gemini-enum) nutzen darf. */
export const ALL_CATEGORIES: string[] = Array.from(
  new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, 'Überweisung']),
);
