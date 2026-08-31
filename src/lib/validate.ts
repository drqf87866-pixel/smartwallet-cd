import type { TransactionAccount, TransactionScope, TransactionType } from '../types';
import { isAllowedCategory } from './categories';

export type TransactionInput = {
  amount: number;
  type: Exclude<TransactionType, 'settlement'>;
  category: string;
  description: string;
  date: string; // ISO 8601 UTC
  scope: TransactionScope;
  paid_from: TransactionAccount;
};

const asAmount = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

/**
 * Validiert Rohdaten (Request-Body oder KI-Antwort) zu einer Transaktion.
 * Fehlende `date` → aktuelle Zeit; `category`/`description` bekommen Fallbacks.
 *
 * Kontoregeln:
 * - persönliche Posten laufen immer übers Privatkonto
 * - Einnahmen gehen immer aufs Privatkonto
 * - gemeinsame Ausgaben default `joint` (Regel: die meisten laufen übers Gemeinskonto)
 * - Überweisungen (`transfer`) laufen immer privat → Gemeinschaftskonto
 */
export function validateTransactionInput(
  raw: unknown,
): { input: TransactionInput } | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Body muss ein JSON-Objekt sein' };
  }
  const body = raw as Record<string, unknown>;

  const amount = asAmount(body.amount);
  if (amount === null || amount <= 0) return { error: 'amount muss eine Zahl größer 0 sein' };

  if (body.type !== 'income' && body.type !== 'expense' && body.type !== 'transfer') {
    return { error: 'type muss "income", "expense" oder "transfer" sein' };
  }
  if (body.scope !== 'personal' && body.scope !== 'shared') {
    return { error: 'scope muss "personal" oder "shared" sein' };
  }

  let paid_from: TransactionAccount = 'joint';
  if (body.paid_from === 'private' || body.paid_from === 'joint') {
    paid_from = body.paid_from;
  }

  // Zwangsregeln überschreiben die Angabe
  if (body.type === 'transfer') {
    // Überweisung aufs Gemeinschaftskonto: Ziel immer das GK
    paid_from = 'joint';
  } else if (body.scope === 'personal' || body.type === 'income') {
    paid_from = 'private';
  }

  let date = new Date().toISOString();
  if (typeof body.date === 'string' && body.date.trim() !== '') {
    const parsed = new Date(body.date);
    if (Number.isNaN(parsed.getTime())) {
      return { error: 'date muss ein gültiges ISO-8601-Datum sein' };
    }
    date = parsed.toISOString();
  }

  const category =
    typeof body.category === 'string' && body.category.trim() !== ''
      ? body.category.trim().slice(0, 50)
      : body.type === 'transfer'
        ? 'Überweisung'
        : 'Sonstiges';
  // "Beitrag" ist der automatischen Beitragsbuchung (/api/contribution)
  // vorbehalten – sonst wäre der Schutz für Beitragseinträge umgehbar
  if (category === 'Beitrag') {
    return { error: 'Die Kategorie "Beitrag" ist reserviert – nutze den Button „Beitrag buchen“' };
  }
  // Nur kanonische Kategorien – Freitext würde in Statistik silently verloren gehen
  if (!isAllowedCategory(category, body.type)) {
    return {
      error:
        body.type === 'transfer'
          ? 'Überweisungen müssen die Kategorie "Überweisung" haben'
          : 'Unbekannte Kategorie – bitte eine Kategorie aus der Auswahlliste wählen',
    };
  }
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 200) : '';

  return {
    input: {
      amount: Math.round(amount * 100) / 100,
      type: body.type,
      scope: body.type === 'transfer' ? 'shared' : body.scope,
      paid_from,
      date,
      category,
      description,
    },
  };
}
