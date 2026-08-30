import type { TransactionAccount, TransactionScope } from '../types';

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

/** Heutiges Datum in Europe/Berlin als YYYY-MM-DD (nicht UTC – sonst verschiebt sich der Buchungstag). */
export function todayBerlin(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
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

/** Nächstes Fälligkeitsdatum nach `afterISO` (Übersicht: „fällig am …“). */
export function nextDueDate(rule: RecurringRule, afterISO: string, skips?: Set<string>): string | null {
  const horizon = clampedDate(
    Number(afterISO.slice(0, 4)) + 2,
    Number(afterISO.slice(5, 7)),
    1,
  );
  const dates = occurrenceDates(rule, afterISO, horizon).filter((d) => d !== afterISO);
  for (const date of dates) {
    if (rule.end_date && date > rule.end_date) return null;
    if (skips?.has(date)) continue;
    return date;
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

    const { results: skipRows } = await db
      .prepare('SELECT due_date FROM recurring_skips WHERE recurring_id = ?1')
      .bind(rule.id)
      .all<{ due_date: string }>();
    const skipSet = new Set(skipRows.map((row) => row.due_date));
    const pending = dates.filter((d) => !skipSet.has(d));
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
