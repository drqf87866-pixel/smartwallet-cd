import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { isCanonicalCategory } from '../lib/categories';

const budgets = new Hono<Env>();

budgets.use('/api/budgets', requireAuth);
budgets.use('/api/budgets/batch', requireAuth);

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type BudgetChange = { month: string; category: string; amount: number };

function validateBudgetChange(raw: unknown, householdId: number): { change: BudgetChange } | { error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'Jeder Eintrag muss ein JSON-Objekt sein' };
  }
  const body = raw as Record<string, unknown>;

  const month = typeof body.month === 'string' ? body.month : 'default';
  if (month !== 'default' && !/^\d{4}-\d{2}$/.test(month)) {
    return { error: 'month muss "default" oder im Format YYYY-MM sein' };
  }

  const category =
    typeof body.category === 'string' ? body.category.trim().slice(0, 50) : '';
  if (category === '') {
    return { error: 'category darf nicht leer sein' };
  }
  if (category === 'Beitrag' || !isCanonicalCategory(category)) {
    return { error: 'Unbekannte Kategorie – bitte eine Kategorie aus der Auswahlliste wählen' };
  }

  const amount = body.amount === undefined || body.amount === null || body.amount === ''
    ? 0
    : toNumber(body.amount);
  if (amount === null) {
    return { error: 'amount muss eine Zahl sein' };
  }
  if (amount > 1_000_000) {
    return { error: 'amount muss kleiner als 1.000.000 sein' };
  }

  return {
    change: {
      month,
      category,
      amount: amount <= 0 ? 0 : Math.round(amount * 100) / 100,
    },
  };
}

budgets.get('/api/budgets', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT month, category, amount FROM budgets WHERE household_id = ?1 ORDER BY month, category')
    .bind(c.get('householdId'))
    .all<{ month: string; category: string; amount: number }>();
  return c.json({ budgets: results });
});

/**
 * Setzt/ändert mehrere Budgets in einem Request – ein db.batch() statt N Roundtrips.
 */
budgets.put('/api/budgets/batch', async (c) => {
  const body = await c.req.json<{ changes?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.changes) || body.changes.length === 0) {
    return c.json({ error: 'changes muss ein nicht-leeres Array sein' }, 400);
  }
  if (body.changes.length > 50) {
    return c.json({ error: 'Maximal 50 Änderungen pro Request' }, 400);
  }

  const householdId = c.get('householdId');
  const validated: BudgetChange[] = [];
  for (const entry of body.changes) {
    const checked = validateBudgetChange(entry, householdId);
    if ('error' in checked) {
      return c.json({ error: checked.error }, 400);
    }
    validated.push(checked.change);
  }

  const deleteStmt = c.env.DB.prepare(
    'DELETE FROM budgets WHERE household_id = ?1 AND month = ?2 AND category = ?3',
  );
  const upsertStmt = c.env.DB.prepare(
    'INSERT INTO budgets (household_id, month, category, amount) VALUES (?1, ?2, ?3, ?4) ' +
      'ON CONFLICT(household_id, month, category) DO UPDATE SET amount = excluded.amount',
  );

  const stmts = validated.map((change) =>
    change.amount <= 0
      ? deleteStmt.bind(householdId, change.month, change.category)
      : upsertStmt.bind(householdId, change.month, change.category, change.amount),
  );
  await c.env.DB.batch(stmts);

  return c.json({ ok: true, count: validated.length });
});

/**
 * Setzt/ändert ein Budget: { month, category, amount }.
 * month = 'YYYY-MM' (monatsspezifisch) oder 'default' (für alle Monate).
 * amount <= 0 / fehlend löscht das Budget.
 */
budgets.put('/api/budgets', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body muss ein JSON-Objekt sein' }, 400);
  }

  const checked = validateBudgetChange(body, c.get('householdId'));
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }
  const { month, category, amount } = checked.change;
  const householdId = c.get('householdId');

  if (amount <= 0) {
    await c.env.DB
      .prepare('DELETE FROM budgets WHERE household_id = ?1 AND month = ?2 AND category = ?3')
      .bind(householdId, month, category)
      .run();
    return c.json({ ok: true, deleted: true, month, category });
  }

  await c.env.DB
    .prepare(
      'INSERT INTO budgets (household_id, month, category, amount) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(household_id, month, category) DO UPDATE SET amount = excluded.amount',
    )
    .bind(householdId, month, category, amount)
    .run();

  return c.json({ ok: true, month, category, amount });
});

export default budgets;
