import { describe, expect, it } from 'vitest';
import { attachNextDue, occurrenceDates, nextDueDate, todayBerlin, validateRecurringInput, type RecurringRule } from '../../src/lib/recurring';

function rule(overrides: Partial<RecurringRule>): RecurringRule {
  return {
    id: 1,
    household_id: 1,
    user_id: 1,
    amount: 10,
    type: 'expense',
    category: 'Sonstiges',
    description: '',
    scope: 'shared',
    paid_from: 'joint',
    frequency: 'monthly',
    day: 1,
    month: null,
    start_date: '2026-01-01',
    end_date: null,
    active: 1,
    ...overrides,
  };
}

describe('occurrenceDates', () => {
  it('monatlich am 31. klemmt auf kürzere Monate', () => {
    const r = rule({ frequency: 'monthly', day: 31 });
    expect(occurrenceDates(r, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('monatlich respektiert start_date als Untergrenze', () => {
    const r = rule({ frequency: 'monthly', day: 5, start_date: '2026-03-20' });
    expect(occurrenceDates(r, '2026-01-01', '2026-05-31')).toEqual(['2026-04-05', '2026-05-05']);
  });

  it('wöchentlich: Montag = 1, erste Occurrence ab Intervallbeginn', () => {
    // 2026-08-31 ist ein Montag
    const r = rule({ frequency: 'weekly', day: 1 });
    expect(occurrenceDates(r, '2026-08-31', '2026-09-14')).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ]);
  });

  it('jährlich nutzt month + day', () => {
    const r = rule({ frequency: 'yearly', day: 24, month: 12 });
    expect(occurrenceDates(r, '2026-01-01', '2028-12-31')).toEqual([
      '2026-12-24',
      '2027-12-24',
      '2028-12-24',
    ]);
  });

  it('Occurrences halten sich an die Intervall-Obergrenze (end_date filtert materializeRecurring/nextDueDate)', () => {
    const r = rule({ frequency: 'monthly', day: 10, end_date: '2026-03-10' });
    // occurrenceDates kennt kein end_date – die Obergrenze kommt als toISO herein
    expect(occurrenceDates(r, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
      '2026-04-10',
      '2026-05-10',
      '2026-06-10',
    ]);
    expect(occurrenceDates(r, '2026-01-01', '2026-03-10')).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ]);
  });
});

describe('nextDueDate', () => {
  it('liefert das nächste Datum nach dem Referenztag', () => {
    const r = rule({ frequency: 'monthly', day: 15 });
    expect(nextDueDate(r, '2026-08-20')).toBe('2026-09-15');
  });

  it('überspringt Einträge in skips', () => {
    const r = rule({ frequency: 'monthly', day: 15 });
    expect(nextDueDate(r, '2026-08-20', new Set(['2026-09-15']))).toBe('2026-10-15');
  });

  it('null hinter end_date', () => {
    const r = rule({ frequency: 'monthly', day: 15, end_date: '2026-08-31' });
    expect(nextDueDate(r, '2026-08-20')).toBeNull();
  });

  it('wöchentlich: nächstes Datum ohne volles occurrenceDates-Array', () => {
    const r = rule({ frequency: 'weekly', day: 1, start_date: '2026-08-31' });
    expect(nextDueDate(r, '2026-08-31')).toBe('2026-09-07');
  });

  it('jährlich: respektiert end_date', () => {
    const r = rule({ frequency: 'yearly', day: 24, month: 12, end_date: '2027-12-24' });
    expect(nextDueDate(r, '2026-12-25')).toBe('2027-12-24');
    expect(nextDueDate(r, '2027-12-24')).toBeNull();
  });
});

describe('attachNextDue', () => {
  it('berechnet next_due aus vorgeladener Skip-Map', () => {
    const rules = [
      rule({ id: 1, frequency: 'monthly', day: 15, active: 1 }),
      rule({ id: 2, frequency: 'monthly', day: 1, active: 0 }),
    ];
    const skipMap = new Map<number, Set<string>>([[1, new Set(['2026-09-15'])]]);
    const result = attachNextDue(rules, skipMap, '2026-08-20');
    expect(result[0].next_due).toBe('2026-10-15');
    expect(result[1].next_due).toBeNull();
  });
});

describe('validateRecurringInput', () => {
  it('leitet day/month aus start_date ab', () => {
    const result = validateRecurringInput({
      amount: 900,
      type: 'expense',
      scope: 'shared',
      category: 'Miete',
      frequency: 'monthly',
      start_date: '2026-09-01',
    });
    expect(result).toMatchObject({ input: { day: 1, month: null, paid_from: 'joint' } });

    const yearly = validateRecurringInput({
      amount: 90,
      type: 'expense',
      scope: 'shared',
      category: 'Versicherung',
      frequency: 'yearly',
      start_date: '2026-12-24',
    });
    expect(yearly).toMatchObject({ input: { day: 24, month: 12 } });
  });

  it('Einnahmen und persönliche Posten laufen immer übers Privatkonto', () => {
    const income = validateRecurringInput({
      amount: 2000,
      type: 'income',
      scope: 'shared',
      category: 'Gehalt',
      frequency: 'monthly',
      start_date: '2026-09-01',
      paid_from: 'joint',
    });
    expect(income).toMatchObject({ input: { paid_from: 'private' } });

    const personal = validateRecurringInput({
      amount: 30,
      type: 'expense',
      scope: 'personal',
      category: 'Sport',
      frequency: 'monthly',
      start_date: '2026-09-01',
    });
    expect(personal).toMatchObject({ input: { paid_from: 'private' } });
  });

  it('lehnt reservierte und unbekannte Kategorien ab', () => {
    expect(
      validateRecurringInput({ amount: 5, type: 'expense', scope: 'shared', category: 'Beitrag', frequency: 'monthly', start_date: '2026-09-01' }),
    ).toHaveProperty('error');
    expect(
      validateRecurringInput({ amount: 5, type: 'expense', scope: 'shared', category: 'Freitext', frequency: 'monthly', start_date: '2026-09-01' }),
    ).toHaveProperty('error');
  });

  it('lehnt ungültige Rhythmen und end_date vor start_date ab', () => {
    expect(
      validateRecurringInput({ amount: 5, type: 'expense', scope: 'shared', frequency: 'daily', start_date: '2026-09-01' }),
    ).toHaveProperty('error');
    expect(
      validateRecurringInput({ amount: 5, type: 'expense', scope: 'shared', frequency: 'monthly', start_date: '2026-09-10', end_date: '2026-09-01' }),
    ).toHaveProperty('error');
  });
});

describe('todayBerlin', () => {
  it('bildet Europe/Berlin ab, nicht UTC (23:30 UTC = nächster Tag in Berlin)', () => {
    // 2026-08-05T23:30Z ist in Berlin bereits der 06.08. (Sommerzeit, UTC+2)
    expect(todayBerlin(new Date('2026-08-05T23:30:00Z'))).toBe('2026-08-06');
  });
});
