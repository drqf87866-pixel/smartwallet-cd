/** Standard-Kategorien des Haushaltsbuchs – Grundlage für Magic Input und Dropdown. */

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

const EXPENSE_SET = new Set<string>(EXPENSE_CATEGORIES);
const INCOME_SET = new Set<string>(INCOME_CATEGORIES);
const ALL_SET = new Set<string>(ALL_CATEGORIES);

/** Zulässige Kategorien je Buchungsart (Grundlage der serverseitigen Validierung). */
export function isAllowedCategory(category: string, type: 'income' | 'expense' | 'transfer'): boolean {
  if (type === 'transfer') return category === 'Überweisung';
  if (type === 'income') return INCOME_SET.has(category);
  return EXPENSE_SET.has(category);
}

/** Prüfung gegen die gesamte kanonische Liste (z. B. wiederkehrende Regeln). */
export function isCanonicalCategory(category: string): boolean {
  return ALL_SET.has(category);
}
