/** Standard-Kategorien des Haushaltsbuchs – Grundlage für Magic Input und Dropdown. */

export const EXPENSE_CATEGORIES = [
  'Wohnen',
  'Essen & Trinken',
  'Mobilität',
  'Gesundheit & Körper',
  'Freizeit & Sonstiges',
] as const;

/** Feste Kategorie für alle Einnahmen – nicht wählbar in der UI. */
export const INCOME_CATEGORY = 'Einnahme' as const;

export const DEFAULT_EXPENSE_CATEGORY = 'Freizeit & Sonstiges' as const;

/** Alt → Neu Mapping für Datenmigration und Tests. */
export const CATEGORY_MIGRATION_MAP: Record<string, string> = {
  Miete: 'Wohnen',
  Strom: 'Wohnen',
  Internet: 'Wohnen',
  Haushalt: 'Wohnen',
  Lebensmittel: 'Essen & Trinken',
  Restaurant: 'Essen & Trinken',
  Café: 'Essen & Trinken',
  Transport: 'Mobilität',
  Tanken: 'Mobilität',
  Drogerie: 'Gesundheit & Körper',
  Gesundheit: 'Gesundheit & Körper',
  Kleidung: 'Gesundheit & Körper',
  Sport: 'Gesundheit & Körper',
  Streaming: 'Freizeit & Sonstiges',
  Freizeit: 'Freizeit & Sonstiges',
  Urlaub: 'Freizeit & Sonstiges',
  Geschenke: 'Freizeit & Sonstiges',
  Bildung: 'Freizeit & Sonstiges',
  Versicherung: 'Freizeit & Sonstiges',
  Sonstiges: 'Freizeit & Sonstiges',
  Gehalt: INCOME_CATEGORY,
  Nebeneinkünfte: INCOME_CATEGORY,
  Verkauf: INCOME_CATEGORY,
  Erstattung: INCOME_CATEGORY,
  Geschenk: INCOME_CATEGORY,
};

/** Alle Kategorien, die der Magic Input (Gemini-enum) nutzen darf. */
export const ALL_CATEGORIES: string[] = Array.from(
  new Set<string>([...EXPENSE_CATEGORIES, INCOME_CATEGORY, 'Überweisung']),
);

const EXPENSE_SET = new Set<string>(EXPENSE_CATEGORIES);
const ALL_SET = new Set<string>(ALL_CATEGORIES);

/** Zulässige Kategorien je Buchungsart (Grundlage der serverseitigen Validierung). */
export function isAllowedCategory(category: string, type: 'income' | 'expense' | 'transfer'): boolean {
  if (type === 'transfer') return category === 'Überweisung';
  if (type === 'income') return category === INCOME_CATEGORY;
  return EXPENSE_SET.has(category);
}

/** Prüfung gegen die gesamte kanonische Liste (z. B. wiederkehrende Regeln). */
export function isCanonicalCategory(category: string): boolean {
  return ALL_SET.has(category);
}
