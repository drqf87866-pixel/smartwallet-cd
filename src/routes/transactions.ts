import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { validateTransactionInput } from '../lib/validate';
import { materializeRecurring, validateRecurringInput } from '../lib/recurring';

const transactions = new Hono<Env>();

transactions.use('/api/transactions', requireAuth);
transactions.use('/api/transactions/:id', requireAuth);
transactions.use('/api/transactions/:id/make-recurring', requireAuth);
transactions.use('/api/export.csv', requireAuth);

/**
 * CSV-Export aller Buchungen des Haushalts (Datensicherung/Steuer).
 * Deutsch-Excel-tauglich: Semikolon-Trenner, Kommabeträge, UTF-8-BOM, CRLF.
 */
transactions.get('/api/export.csv', async (c) => {
  const householdId = c.get('householdId');
  const { results } = await c.env.DB
    .prepare(
      `SELECT t.id, t.date, t.type, t.scope, t.paid_from, t.category, t.description,
              t.amount, u.name AS created_by, t.recurring_id
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       WHERE u.household_id = ?1
       ORDER BY t.date ASC, t.id ASC
       LIMIT 20000`,
    )
    .bind(householdId)
    .all<{
      id: number;
      date: string;
      type: string;
      scope: string;
      paid_from: string;
      category: string;
      description: string;
      amount: number;
      created_by: string;
      recurring_id: number | null;
    }>();

  const escape = (value: string | number | null): string => {
    const s = value === null ? '' : String(value);
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = 'Datum;Art;Bereich;Konto;Kategorie;Beschreibung;Betrag;Erstellt von;Regel-ID';
  const lines = results.map((r) =>
    [
      r.date,
      r.type,
      r.scope,
      r.paid_from,
      r.category,
      r.description,
      r.amount.toFixed(2).replace('.', ','),
      r.created_by,
      r.recurring_id === null ? '' : String(r.recurring_id),
    ]
      .map(escape)
      .join(';'),
  );
  const csv = '\uFEFF' + header + '\r\n' + lines.join('\r\n') + '\r\n';

  const filename = `smartwallet-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

transactions.get('/api/transactions', async (c) => {
  const month = c.req.query('month'); // optional: "YYYY-MM"
  const householdId = c.get('householdId');
  const userId = c.get('userId');
  const binds: (string | number)[] = [householdId];

  // Persönliche Buchungen anderer Mitglieder werden nicht ausgeliefert –
  // nur eigene ('personal') und gemeinsame ('shared') Buchungen.
  let sql = `
    SELECT t.id, t.user_id, u.name AS created_by, t.amount, t.type, t.category,
           t.description, t.date, t.scope, t.paid_from, t.recurring_id
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE u.household_id = ?1
  `;
  if (month !== undefined) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ error: 'month muss im Format YYYY-MM sein' }, 400);
    }
    // ISO-Strings sortieren lexikographisch → Monatsfilter per Präfix-Match
    sql += ' AND t.date LIKE ?2';
    binds.push(`${month}%`);
  }
  sql += ` AND (t.scope = 'shared' OR t.user_id = ?${binds.length + 1})`;
  binds.push(userId);
  sql += ' ORDER BY t.date DESC LIMIT 200';

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return c.json({ transactions: results });
});

transactions.post('/api/transactions', async (c) => {
  const body = await c.req.json().catch(() => null);
  const checked = validateTransactionInput(body);
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }

  const userId = c.get('userId');
  const t = checked.input;
  await c.env.DB.prepare(
    'INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  )
    .bind(userId, t.amount, t.type, t.category, t.description, t.date, t.scope, t.paid_from)
    .run();

  return c.json(
    {
      transaction: {
        user_id: userId,
        created_by: c.get('userName'),
        ...t,
      },
    },
    201,
  );
});

/**
 * Lädt eine Transaktion, sofern sie zum Haushalt des Aufrufers gehört
 * und nicht schreibgeschützt ist (settlement/Beitrag). Persönliche
 * Buchungen anderer Mitglieder gelten dabei als „nicht gefunden“ – so
 * lassen sie sich auch per erratener ID nicht einsehen oder verändern.
 */
async function loadEditableTransaction(
  db: Env['Bindings']['DB'],
  id: number,
  householdId: number,
  callerId: number,
): Promise<{ row: Record<string, unknown> } | { error: string; status: number }> {
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Ungültige Transaktions-ID', status: 400 };
  }
  const { results } = await db
    .prepare(
      `SELECT t.id, t.user_id, t.amount, t.type, t.category, t.description,
              t.date, t.scope, t.paid_from, t.recurring_id
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       WHERE t.id = ?1 AND u.household_id = ?2
       LIMIT 1`,
    )
    .bind(id, householdId)
    .all();
  const row = results[0];
  if (!row || (row.scope === 'personal' && row.user_id !== callerId)) {
    return { error: 'Transaktion nicht gefunden', status: 404 };
  }
  if (row.type === 'settlement' || row.category === 'Beitrag') {
    return { error: 'Ausgleiche und Beiträge können nicht bearbeitet werden', status: 403 };
  }
  return { row };
}

transactions.put('/api/transactions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const found = await loadEditableTransaction(c.env.DB, id, c.get('householdId'), c.get('userId'));
  if ('error' in found) {
    return c.json({ error: found.error }, found.status as 400 | 403 | 404);
  }

  const body = await c.req.json().catch(() => null);
  const checked = validateTransactionInput(body);
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }

  const t = checked.input;
  await c.env.DB.prepare(
    'UPDATE transactions SET amount = ?1, type = ?2, category = ?3, description = ?4, date = ?5, scope = ?6, paid_from = ?7 WHERE id = ?8',
  )
    .bind(t.amount, t.type, t.category, t.description, t.date, t.scope, t.paid_from, id)
    .run();

  // Datum einer wiederkehrenden Occurrence verschoben? Dann den ursprünglichen
  // Fälligkeitstermin merken, damit die Materialization sie nicht neu anlegt.
  const oldRecurringId = found.row.recurring_id;
  const oldDueDate = String(found.row.date).slice(0, 10);
  if (oldRecurringId != null && t.date.slice(0, 10) !== oldDueDate) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO recurring_skips (recurring_id, due_date) VALUES (?1, ?2)',
    )
      .bind(oldRecurringId, oldDueDate)
      .run();
  }

  return c.json({
    transaction: {
      id,
      user_id: found.row.user_id,
      created_by: c.get('userName'),
      ...t,
    },
  });
});

transactions.delete('/api/transactions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const found = await loadEditableTransaction(c.env.DB, id, c.get('householdId'), c.get('userId'));
  if ('error' in found) {
    return c.json({ error: found.error }, found.status as 400 | 403 | 404);
  }

  // Gelöschte Occurrence merken, damit die Materialization sie nicht neu anlegt
  if (found.row.recurring_id != null) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO recurring_skips (recurring_id, due_date) VALUES (?1, ?2)',
    )
      .bind(found.row.recurring_id, String(found.row.date).slice(0, 10))
      .run();
  }

  await c.env.DB.prepare('DELETE FROM transactions WHERE id = ?1').bind(id).run();
  return c.json({ ok: true });
});

/**
 * Wandelt eine bestehende Transaktion in eine wiederkehrende Regel um:
 * legt eine recurring_rules-Zeile mit den Transaktionswerten an, verlinkt
 * die Transaktion rückwirkend (recurring_id) und trägt ihr eigenes
 * Fälligkeitsdatum als Skip ein, damit die Materialization sie nicht
 * doppelt anlegt.
 */
transactions.post('/api/transactions/:id/make-recurring', async (c) => {
  const id = Number(c.req.param('id'));
  const householdId = c.get('householdId');
  const found = await loadEditableTransaction(c.env.DB, id, householdId, c.get('userId'));
  if ('error' in found) {
    return c.json({ error: found.error }, found.status as 400 | 403 | 404);
  }
  const row = found.row;

  if (row.recurring_id != null) {
    return c.json({ error: 'Diese Transaktion ist bereits Teil einer wiederkehrenden Regel' }, 400);
  }
  if (row.type === 'transfer') {
    return c.json({ error: 'Überweisungen können nicht in eine wiederkehrende Regel umgewandelt werden' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const checked = validateRecurringInput({
    amount: row.amount,
    type: row.type,
    category: row.category,
    description: row.description,
    scope: row.scope,
    paid_from: row.paid_from,
    frequency: raw.frequency,
    start_date: String(row.date).slice(0, 10),
    end_date: raw.end_date,
  });
  if ('error' in checked) {
    return c.json({ error: checked.error }, 400);
  }
  const r = checked.input;

  const result = await c.env.DB.prepare(
    `INSERT INTO recurring_rules
       (household_id, user_id, amount, type, category, description, scope, paid_from,
        frequency, day, month, start_date, end_date)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     RETURNING id`,
  )
    .bind(
      householdId, row.user_id, r.amount, r.type, r.category, r.description,
      r.scope, r.paid_from, r.frequency, r.day, r.month, r.start_date, r.end_date,
    )
    .first<{ id: number }>();
  if (!result) {
    return c.json({ error: 'Regel konnte nicht angelegt werden' }, 500);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE transactions SET recurring_id = ?1 WHERE id = ?2').bind(result.id, id),
    c.env.DB
      .prepare('INSERT OR IGNORE INTO recurring_skips (recurring_id, due_date) VALUES (?1, ?2)')
      .bind(result.id, r.start_date),
  ]);

  // Evtl. weitere seither fällige Vorkommen der neuen Regel nachziehen
  await materializeRecurring(c.env.DB, householdId);

  return c.json(
    {
      transaction: { ...row, id, recurring_id: result.id },
      rule: { id: result.id, ...r, active: 1 },
    },
    201,
  );
});

export default transactions;
