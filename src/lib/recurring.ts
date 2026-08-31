import type { TransactionAccount, TransactionScope } from '../types';
import { isAllowedCategory } from './categories';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export type RecurringRule = {
  id: number;
  household_id: number;
  user_id: number;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  scope: TransactionScope;
  paid_from: TransactionAccount;
  frequency: RecurringFrequency;
  day: number;
  month: number | null;
  start_date: string;
  end_date: string | null;
  active: number;
};

export type RecurringInput = {
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  scope: TransactionScope;
  paid_from: TransactionAccount;
  frequency: RecurringFrequency;
  day: number;
  month: number | null;
  start_date: string;
  end_date: string | null;
};

/** Occurrence-Zeit: deterministisch 12:00 UTC, damit der Unique-Index deduped. */
const OCCURRENCE_TIME = 'T12:00:00.000Z';

/** Max. 24 Monate rückwirkend werden nachträglich erzeugt. */
const BACKFILL_MONTHS = 24;

const WEEKDAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

// Formatter einmalig anlegen – vermeidet wiederholte Intl-Konstruktion pro Request
const berlinDayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' });

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD (nicht UTC – sonst verschiebt sich der Buchungstag). */
export function todayBerlin(now = new Date()): string {
  return berlinDayFmt.format(now);
}

const isDateStr = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + OCCURRENCE_TIME));

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const asAmount = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim().replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

/**
 * Validiert Rohdaten zu einer wiederkehrenden Zahlung.
 * Kontoregeln wie validateTransactionInput: Einnahmen und persönliche Posten
 * laufen immer übers Privatkonto.
 *
 * Der Rhythmus (day/weekday, month) wird aus start_date (= „Fällig am“)
 * abgeleitet – ein body.day/body.month wird ignoriert.
 */
export function validateRecurringInput(
  raw: unknown,
): { input: RecurringInput } | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Body muss ein JSON-Objekt sein' };
  }
  const body = raw as Record<string, unknown>;

  const amount = asAmount(body.amount);
  if (amount === null || amount <= 0) return { error: 'amount muss eine Zahl größer 0 sein' };

  if (body.type !== 'income' && body.type !== 'expense') {
    return { error: 'type muss "income" oder "expense" sein' };
  }
  if (body.scope !== 'personal' && body.scope !== 'shared') {
    return { error: 'scope muss "personal" oder "shared" sein' };
  }

  let paid_from: TransactionAccount = 'joint';
  if (body.paid_from === 'private' || body.paid_from === 'joint') {
    paid_from = body.paid_from;
  }
  if (body.scope === 'personal' || body.type === 'income') {
    paid_from = 'private';
  }

  const frequency = body.frequency;
  if (frequency !== 'weekly' && frequency !== 'monthly' && frequency !== 'yearly') {
    return { error: 'frequency muss "weekly", "monthly" oder "yearly" sein' };
  }

  if (!isDateStr(body.start_date)) {
    return { error: 'start_date muss ein Datum im Format YYYY-MM-DD sein' };
  }
  const start_date = String(body.start_date);

  // Rhythmus aus dem Fälligkeitsdatum ableiten
  const day = frequency === 'weekly'
    ? (new Date(start_date + OCCURRENCE_TIME).getUTCDay() + 6) % 7 + 1 // Mo = 1 … So = 7
    : Number(start_date.slice(8, 10));
  let month: number | null = null;
  if (frequency === 'yearly') {
    month = Number(start_date.slice(5, 7));
  }

  let end_date: string | null = null;
  if (body.end_date !== undefined && body.end_date !== null && body.end_date !== '') {
    if (!isDateStr(body.end_date)) {
      return { error: 'end_date muss ein Datum im Format YYYY-MM-DD sein' };
    }
    if (String(body.end_date) < start_date) {
      return { error: 'end_date darf nicht vor start_date liegen' };
    }
    end_date = String(body.end_date);
  }

  const category =
    typeof body.category === 'string' && body.category.trim() !== ''
      ? body.category.trim().slice(0, 50)
      : 'Sonstiges';
  if (category === 'Beitrag') {
    return { error: 'Die Kategorie "Beitrag" ist reserviert – nutze den Button „Beitrag buchen“' };
  }
  // Nur kanonische Kategorien – Freitext würde in Statistik silently verloren gehen
  if (!isAllowedCategory(category, body.type)) {
    return { error: 'Unbekannte Kategorie – bitte eine Kategorie aus der Auswahlliste wählen' };
  }
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 200) : '';

  return {
    input: {
      amount: Math.round(amount * 100) / 100,
      type: body.type,
      scope: body.scope,
      paid_from,
      frequency,
      day,
      month,
      start_date,
      end_date,
      category,
      description,
    },
  };
}

/** Klemmt day auf den Monatsletzten (29–31 bei kurzen Monaten). */
function clampedDate(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monat um n Monate shiften (Tag egal, nur YYYY-MM relevant). */
function shiftMonthPrefix(prefix: string, delta: number): string {
  const [y, m] = prefix.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Alle Fälligkeitsdaten einer Regel im geschlossenen Intervall [fromISO, toISO]
 * (jeweils YYYY-MM-DD, lexikographischer Vergleich).
 */
export function occurrenceDates(rule: RecurringRule, fromISO: string, toISO: string): string[] {
  const dates: string[] = [];
  const lower = rule.start_date > fromISO ? rule.start_date : fromISO;
  const upper = toISO;

  if (rule.frequency === 'weekly') {
    // Erstes Vorkommen des Wochentags ab `lower`
    const cursor = new Date(lower + OCCURRENCE_TIME);
    const offset = (rule.day - 1 - (cursor.getUTCDay() + 6) % 7 + 7) % 7;
    cursor.setUTCDate(cursor.getUTCDate() + offset);
    while (cursor.toISOString().slice(0, 10) <= upper) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return dates;
  }

  if (rule.frequency === 'monthly') {
    let [year, month] = lower.split('-').map(Number);
    while (clampedDate(year, month, rule.day) <= upper) {
      const date = clampedDate(year, month, rule.day);
      if (date >= lower) dates.push(date);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return dates;
  }

  // yearly
  let year = Number(lower.slice(0, 4));
  const month = rule.month!;
  while (clampedDate(year, month, rule.day) <= upper) {
    const date = clampedDate(year, month, rule.day);
    if (date >= lower) dates.push(date);
    year += 1;
  }
  return dates;
}

/** Prüft ein Kandidatdatum und überspringt bei end_date/skips. */
function acceptDueDate(
  date: string,
  rule: RecurringRule,
  skips: Set<string> | undefined,
): string | null {
  if (date < rule.start_date) return null;
  if (rule.end_date && date > rule.end_date) return null;
  if (skips?.has(date)) return null;
  return date;
}

/** Nächstes Fälligkeitsdatum nach `afterISO` (Übersicht: „fällig am …“). */
export function nextDueDate(rule: RecurringRule, afterISO: string, skips?: Set<string>): string | null {
  const horizon = clampedDate(
    Number(afterISO.slice(0, 4)) + 2,
    Number(afterISO.slice(5, 7)),
    1,
  );

  // Schrittweise Vorschreitung statt occurrenceDates-Array – O(k) statt O(H) Allokationen
  if (rule.frequency === 'weekly') {
    const cursor = new Date(afterISO + OCCURRENCE_TIME);
    const offset = (rule.day - 1 - (cursor.getUTCDay() + 6) % 7 + 7) % 7;
    cursor.setUTCDate(cursor.getUTCDate() + offset);
    let date = cursor.toISOString().slice(0, 10);
    if (date <= afterISO) {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
      date = cursor.toISOString().slice(0, 10);
    }
    while (date <= horizon) {
      const accepted = acceptDueDate(date, rule, skips);
      if (accepted) return accepted;
      if (rule.end_date && date > rule.end_date) return null;
      cursor.setUTCDate(cursor.getUTCDate() + 7);
      date = cursor.toISOString().slice(0, 10);
    }
    return null;
  }

  if (rule.frequency === 'monthly') {
    let [year, month] = afterISO.split('-').map(Number);
    let date = clampedDate(year, month, rule.day);
    if (date <= afterISO) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      date = clampedDate(year, month, rule.day);
    }
    while (date <= horizon) {
      const accepted = acceptDueDate(date, rule, skips);
      if (accepted) return accepted;
      if (rule.end_date && date > rule.end_date) return null;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
      date = clampedDate(year, month, rule.day);
    }
    return null;
  }

  // yearly
  let year = Number(afterISO.slice(0, 4));
  const month = rule.month!;
  let date = clampedDate(year, month, rule.day);
  if (date <= afterISO) {
    year += 1;
    date = clampedDate(year, month, rule.day);
  }
  while (date <= horizon) {
    const accepted = acceptDueDate(date, rule, skips);
    if (accepted) return accepted;
    if (rule.end_date && date > rule.end_date) return null;
    year += 1;
    date = clampedDate(year, month, rule.day);
  }
  return null;
}

/** Menschliche Beschreibung des Rhythmus für die UI. */
export function frequencyLabel(rule: Pick<RecurringRule, 'frequency' | 'day' | 'month'>): string {
  if (rule.frequency === 'weekly') return `wöchentlich, ${WEEKDAY_NAMES[rule.day - 1]}`;
  if (rule.frequency === 'monthly') return `monatlich am ${rule.day}.`;
  const monthName = MONTH_NAMES[(rule.month ?? 1) - 1];
  return `jährlich am ${rule.day}. ${monthName}`;
}

/** Lädt alle Skips für die gegebenen Regeln in einem Query – vermeidet N+1. */
export async function loadSkipMap(db: D1Database, ruleIds: number[]): Promise<Map<number, Set<string>>> {
  const map = new Map<number, Set<string>>();
  if (ruleIds.length === 0) return map;

  const placeholders = ruleIds.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(`SELECT recurring_id, due_date FROM recurring_skips WHERE recurring_id IN (${placeholders})`)
    .bind(...ruleIds)
    .all<{ recurring_id: number; due_date: string }>();

  for (const row of results) {
    let set = map.get(row.recurring_id);
    if (!set) {
      set = new Set<string>();
      map.set(row.recurring_id, set);
    }
    set.add(row.due_date);
  }
  return map;
}

/** Berechnet next_due für alle Regeln synchron (Skip-Map muss vorab geladen sein). */
export function attachNextDue<T extends RecurringRule>(
  rules: T[],
  skipMap: Map<number, Set<string>>,
  today: string,
): (T & { next_due: string | null })[] {
  return rules.map((rule) => {
    if (!rule.active) return { ...rule, next_due: null };
    return {
      ...rule,
      next_due: nextDueDate(rule, today, skipMap.get(rule.id)),
    };
  });
}

/**
 * Lazy Materialization: erzeugt alle fälligen Occurrences bis heute (Berlin)
 * als normale Transaktionen. Idempotent über den Unique-Index
 * (recurring_id, date); gelöschte Occurrences stehen in recurring_skips.
 */
export async function materializeRecurring(
  db: D1Database,
  householdId: number,
  today = todayBerlin(),
): Promise<void> {
  const { results: rules } = await db
    .prepare('SELECT * FROM recurring_rules WHERE household_id = ?1 AND active = 1')
    .bind(householdId)
    .all<RecurringRule>();
  if (rules.length === 0) return;

  // Untergrenze: max. BACKFILL_MONTHS zurück (Monatsanfang, Tag-Effekte egal)
  const backfillFloor = `${shiftMonthPrefix(today.slice(0, 7), -BACKFILL_MONTHS)}-01`;

  // Ein Query für alle Skips statt pro Regel – reduziert Roundtrips von O(R) auf O(1)
  const skipMap = await loadSkipMap(db, rules.map((r) => r.id));

  const insert = db.prepare(
    `INSERT OR IGNORE INTO transactions
       (user_id, amount, type, category, description, date, scope, paid_from, recurring_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  );

  for (const rule of rules) {
    const upper = rule.end_date && rule.end_date < today ? rule.end_date : today;
    const lower = backfillFloor;
    if (lower > upper) continue;

    const dates = occurrenceDates(rule, lower, upper);
    if (dates.length === 0) continue;

    const skipSet = skipMap.get(rule.id);
    const pending = skipSet ? dates.filter((d) => !skipSet.has(d)) : dates;
    if (pending.length === 0) continue;
    await db.batch(
      pending.map((d) =>
        insert.bind(
          rule.user_id, rule.amount, rule.type, rule.category, rule.description,
          d + OCCURRENCE_TIME, rule.scope, rule.paid_from, rule.id,
        ),
      ),
    );
  }
}
