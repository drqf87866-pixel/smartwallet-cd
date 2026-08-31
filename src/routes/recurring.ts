import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { validateRecurringInput, nextDueDate, todayBerlin, materializeRecurring, type RecurringRule } from '../lib/recurring';

const recurring = new Hono<Env>();

recurring.use('/api/recurring', requireAuth);
recurring.use('/api/recurring/:id', requireAuth);
recurring.use('/api/recurring/:id/book', requireAuth);

/**
 * Lädt eine Regel, sofern sie zum Haushalt des Aufrufers gehört. Persönliche
 * Regeln anderer Mitglieder gelten dabei als nicht vorhanden.
 */
async function loadHouseholdRule(
  db: Env['Bindings']['DB'],
  id: number,
  householdId: number,
  callerId: number,
): Promise<RecurringRule | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const rule = await db
    .prepare('SELECT * FROM recurring_rules WHERE id = ?1 AND household_id = ?2')
    .bind(id, householdId)
    .first<RecurringRule>();
  if (!rule || (rule.scope === 'personal' && rule.user_id !== callerId)) return null;
  return rule;
}

recurring.get('/api/recurring', async (c) => {
  const householdId = c.get('householdId');
  const userId = c.get('userId');
  // Persönliche Regeln anderer Mitglieder bleiben ausgeblendet.
  const { results: rules } = await c.env.DB
    .prepare(
      "SELECT * FROM recurring_rules WHERE household_id = ?1 AND (scope = 'shared' OR user_id = ?2) ORDER BY active DESC, id ASC",
    )
    .bind(householdId, userId)
    .all<RecurringRule>();

  const today = todayBerlin();
  const withNextDue = await Promise.all(
    rules.map(async (rule) => {
      if (!rule.active) return { ...rule, next_due: null };
      const { results: skips } = await c.env.DB
        .prepare('SELECT due_date FROM recurring_skips WHERE recurring_id = ?1')
        .bind(rule.id)
        .all<{ due_date: string }>();
      return {
        ...rule,
        next_due: nextDueDate(rule, today, new Set(skips.map((s) => s.due_date))),
      };
    }),
  );

  return c.json({ rules: withNextDue, today });
});

recurring.post('/api/recurring', async (c) => {
  const body = await c.req.json().catch(() => null);
  const checked = validateRecurringInput(body);
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }

  const r = checked.input;
  const result = await c.env.DB
    .prepare(
      `INSERT INTO recurring_rules
         (household_id, user_id, amount, type, category, description, scope, paid_from,
          frequency, day, month, start_date, end_date)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       RETURNING id`,
    )
    .bind(
      c.get('householdId'), c.get('userId'), r.amount, r.type, r.category, r.description,
      r.scope, r.paid_from, r.frequency, r.day, r.month, r.start_date, r.end_date,
    )
    .first<{ id: number }>();
  if (!result) {
    return c.json({ error: 'Regel konnte nicht angelegt werden' }, 500);
  }

  // Fällige Occurrences sofort materialisieren (z. B. Startdatum in der Vergangenheit)
  await materializeRecurring(c.env.DB, c.get('householdId'));

  return c.json({ rule: { id: result.id, ...r, active: 1, next_due: nextDueDate({ ...r, id: result.id, household_id: c.get('householdId'), user_id: c.get('userId'), active: 1 }, todayBerlin()) } }, 201);
});

/**
 * Sofortbuchen: die nächste offene Fälligkeit einer Regel wird sofort als
 * normale Transaktion gebucht (Datum = jetzt) statt aufs Fälligkeitsdatum zu
 * warten. Die Occurrence landet in recurring_skips, damit die Materialization
 * sie am Fälligkeitstag nicht erneut anlegt.
 */
recurring.post('/api/recurring/:id/book', async (c) => {
  const id = Number(c.req.param('id'));
  const rule = await loadHouseholdRule(c.env.DB, id, c.get('householdId'), c.get('userId'));
  if (!rule) {
    return c.json({ error: 'Regel nicht gefunden' }, 404);
  }
  if (!rule.active) {
    return c.json({ error: 'Regel ist pausiert – bitte zuerst aktivieren' }, 400);
  }

  // Lazy Materialization: stellt sicher, dass alle Fälligkeiten bis heute gebucht sind
  await materializeRecurring(c.env.DB, c.get('householdId'));

  const today = todayBerlin();
  const { results: skipRows } = await c.env.DB
    .prepare('SELECT due_date FROM recurring_skips WHERE recurring_id = ?1')
    .bind(rule.id)
    .all<{ due_date: string }>();
  const target = nextDueDate(rule, today, new Set(skipRows.map((s) => s.due_date)));
  if (!target) {
    return c.json({ error: 'Keine offene Fälligkeit – die Regel ist abgeschlossen' }, 400);
  }

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO transactions
           (user_id, amount, type, category, description, date, scope, paid_from, recurring_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        rule.user_id, rule.amount, rule.type, rule.category, rule.description,
        new Date().toISOString(), rule.scope, rule.paid_from, rule.id,
      ),
    c.env.DB
      .prepare('INSERT OR IGNORE INTO recurring_skips (recurring_id, due_date) VALUES (?1, ?2)')
      .bind(rule.id, target),
  ]);

  return c.json({ ok: true, booked_due_date: target });
});

recurring.put('/api/recurring/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await loadHouseholdRule(c.env.DB, id, c.get('householdId'), c.get('userId'));
  if (!existing) {
    return c.json({ error: 'Regel nicht gefunden' }, 404);
  }

  const body = await c.req.json().catch(() => null);
  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'Body muss ein JSON-Objekt sein' }, 400);
  }
  const raw = body as Record<string, unknown>;

  // Nur-Toggle: { active: true/false }
  const keys = Object.keys(raw);
  if (keys.length === 1 && keys[0] === 'active') {
    if (typeof raw.active !== 'boolean') {
      return c.json({ error: 'active muss true oder false sein' }, 400);
    }
    await c.env.DB.prepare('UPDATE recurring_rules SET active = ?1 WHERE id = ?2')
      .bind(raw.active ? 1 : 0, id)
      .run();
    return c.json({ ok: true, active: raw.active });
  }

  // Komplettes Update – ändert nur Zukunft, bereits erzeugte Transaktionen bleiben
  const checked = validateRecurringInput(raw);
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }
  const r = checked.input;
  // end_date nur überschreiben, wenn im Body vorhanden – sonst bestehendes Ende behalten
  // (die UI pflegt kein Enddatum mehr und sendet den Key daher nicht)
  const endDate = 'end_date' in raw ? r.end_date : existing.end_date;
  await c.env.DB
    .prepare(
      `UPDATE recurring_rules SET amount = ?1, type = ?2, category = ?3, description = ?4,
         scope = ?5, paid_from = ?6, frequency = ?7, day = ?8, month = ?9,
         start_date = ?10, end_date = ?11
       WHERE id = ?12`,
    )
    .bind(
      r.amount, r.type, r.category, r.description, r.scope, r.paid_from,
      r.frequency, r.day, r.month, r.start_date, endDate, id,
    )
    .run();

  const updated = await loadHouseholdRule(c.env.DB, id, c.get('householdId'), c.get('userId'));
  return c.json({
    rule: updated
      ? { ...updated, next_due: updated.active ? nextDueDate(updated, todayBerlin()) : null }
      : null,
  });
});

recurring.delete('/api/recurring/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = await loadHouseholdRule(c.env.DB, id, c.get('householdId'), c.get('userId'));
  if (!existing) {
    return c.json({ error: 'Regel nicht gefunden' }, 404);
  }
  // Löscht nur die Regel – bereits erzeugte Transaktionen bleiben bestehen
  // (recurring_id wird per ON DELETE SET NULL auf NULL gesetzt).
  await c.env.DB.prepare('DELETE FROM recurring_rules WHERE id = ?1').bind(id).run();
  return c.json({ ok: true });
});

export default recurring;
