import { describe, expect, it } from 'vitest';
import { validateTransactionInput } from '../../src/lib/validate';

const base = { amount: 10, type: 'expense', scope: 'shared' };

describe('validateTransactionInput', () => {
  it('akzeptiert eine gültige gemeinsame Ausgabe', () => {
    const result = validateTransactionInput({ ...base, category: 'Lebensmittel', paid_from: 'joint' });
    expect(result).toMatchObject({
      input: { amount: 10, type: 'expense', scope: 'shared', paid_from: 'joint', category: 'Lebensmittel' },
    });
  });

  it('parsert deutsche Komma-Beträge und rundet auf Cent', () => {
    const result = validateTransactionInput({ ...base, amount: '12,9', category: 'Café' });
    expect(result).toMatchObject({ input: { amount: 12.9 } });
    const rounded = validateTransactionInput({ ...base, amount: 10.005, category: 'Café' });
    if ('input' in rounded) expect(rounded.input.amount).toBe(10.01);
  });

  it('lehnt Beträge ≤ 0 und Nicht-Zahlen ab', () => {
    expect(validateTransactionInput({ ...base, amount: 0 })).toHaveProperty('error');
    expect(validateTransactionInput({ ...base, amount: -5 })).toHaveProperty('error');
    expect(validateTransactionInput({ ...base, amount: 'abc' })).toHaveProperty('error');
  });

  it('persönliche Posten und Einnahmen laufen immer übers Privatkonto', () => {
    const personal = validateTransactionInput({ ...base, scope: 'personal', category: 'Sport', paid_from: 'joint' });
    expect(personal).toMatchObject({ input: { paid_from: 'private' } });
    const income = validateTransactionInput({ amount: 100, type: 'income', scope: 'shared', category: 'Gehalt', paid_from: 'joint' });
    expect(income).toMatchObject({ input: { paid_from: 'private' } });
  });

  it('Überweisungen: falsche Kategorie wird abgelehnt, fehlende erzwungen, Ziel GK', () => {
    expect(
      validateTransactionInput({ amount: 700, type: 'transfer', scope: 'personal', category: 'Sonstiges' }),
    ).toHaveProperty('error');

    const result = validateTransactionInput({ amount: 700, type: 'transfer', scope: 'personal', category: 'Überweisung' });
    expect(result).toMatchObject({
      input: { type: 'transfer', scope: 'shared', paid_from: 'joint', category: 'Überweisung' },
    });
  });

  it('Kategorie "Beitrag" ist reserviert', () => {
    expect(validateTransactionInput({ ...base, category: 'Beitrag' })).toHaveProperty('error');
  });

  it('unbekannte Kategorien werden abgelehnt', () => {
    expect(validateTransactionInput({ ...base, category: 'Freitext' })).toHaveProperty('error');
  });

  it('fehlende Kategorie bekommt einen Fallback je nach Art', () => {
    expect(validateTransactionInput(base)).toMatchObject({ input: { category: 'Sonstiges' } });
    expect(
      validateTransactionInput({ amount: 1, type: 'transfer', scope: 'shared' }),
    ).toMatchObject({ input: { category: 'Überweisung' } });
  });

  it('normalisiert explizite Daten nach ISO-8601 und nutzt sonst die aktuelle Zeit', () => {
    const explicit = validateTransactionInput({ ...base, category: 'Café', date: '2026-08-15T19:00:00.000Z' });
    expect(explicit).toMatchObject({ input: { date: '2026-08-15T19:00:00.000Z' } });

    const fallback = validateTransactionInput(base);
    if ('input' in fallback) expect(fallback.input.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(validateTransactionInput({ ...base, date: 'kein-datum' })).toHaveProperty('error');
  });
});
