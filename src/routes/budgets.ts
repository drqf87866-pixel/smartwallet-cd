import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';

const budgets = new Hono<Env>();

budgets.use('/api/budgets', requireAuth);

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

budgets.get('/api/budgets', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT month, category, amount FROM budgets WHERE household_id = ?1 ORDER BY month, category')
    .bind(c.get('householdId'))
    .all<{ month: string; category: string; amount: number }>();
  return c.json({ budgets: results });
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

  const month = typeof body.month === 'string' ? body.month : 'default';
  if (month !== 'default' && !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: 'month muss "default" oder im Format YYYY-MM sein' }, 400);
  }

  const category =
    typeof body.category === 'string' ? body.category.trim().slice(0, 50) : '';
  if (category === '') {
    return c.json({ error: 'category darf nicht leer sein' }, 400);
  }

  const householdId = c.get('householdId');

  const amount = body.amount === undefined || body.amount === null || body.amount === ''
    ? 0
    : toNumber(body.amount);
  if (amount === null) {
    return c.json({ error: 'amount muss eine Zahl sein' }, 400);
  }

  if (amount <= 0) {
    await c.env.DB
      .prepare('DELETE FROM budgets WHERE household_id = ?1 AND month = ?2 AND category = ?3')
      .bind(householdId, month, category)
      .run();
    return c.json({ ok: true, deleted: true, month, category });
  }

  if (amount > 1_000_000) {
    return c.json({ error: 'amount muss kleiner als 1.000.000 sein' }, 400);
  }

  await c.env.DB
    .prepare(
      'INSERT INTO budgets (household_id, month, category, amount) VALUES (?1, ?2, ?3, ?4) ' +
        'ON CONFLICT(household_id, month, category) DO UPDATE SET amount = excluded.amount',
    )
    .bind(householdId, month, category, Math.round(amount * 100) / 100)
    .run();

  return c.json({ ok: true, month, category, amount: Math.round(amount * 100) / 100 });
});

export default budgets;
