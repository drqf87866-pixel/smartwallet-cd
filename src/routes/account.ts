import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';

const account = new Hono<Env>();

account.use('/api/settings', requireAuth);
account.use('/api/contribution', requireAuth);
account.use('/api/settlements', requireAuth);

const START_KEY = 'joint_start_balance';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function getSettings(db: D1Database, householdId: number) {
  const { results } = await db
    .prepare('SELECT key, value FROM settings WHERE household_id = ?1')
    .bind(householdId)
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((row) => [row.key, row.value]));
  return {
    start: toNumber(map.get(START_KEY), 0),
  };
}

account.get('/api/settings', async (c) => {
  const settings = await getSettings(c.env.DB, c.get('householdId'));
  return c.json({
    joint_start_balance: settings.start,
  });
});

account.put('/api/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body muss ein JSON-Objekt sein' }, 400);
  }

  const householdId = c.get('householdId');
  const updates: { key: string; value: string }[] = [];
  if (START_KEY in body) {
    const value = toNumber(body[START_KEY], -1);
    if (value < 0) return c.json({ error: 'joint_start_balance muss eine Zahl ≥ 0 sein' }, 400);
    updates.push({ key: START_KEY, value: String(Math.round(value * 100) / 100) });
  }
  if (updates.length === 0) {
    return c.json({ error: 'Keine gültigen Einstellungen übergeben' }, 400);
  }

  const stmt = c.env.DB.prepare(
    'INSERT INTO settings (household_id, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value',
  );
  await c.env.DB.batch(updates.map((u) => stmt.bind(householdId, u.key, u.value)));

  const settings = await getSettings(c.env.DB, householdId);
  return c.json({
    joint_start_balance: settings.start,
  });
});

/**
 * Bucht den eigenen Monatsbeitrag (users.monthly_contribution, wird pro
 * Mitglied unter /settings gesetzt) als Transfer aufs Gemeinschaftskonto.
 * Pro Nutzer und Monat nur einmal – zweiter Aufruf liefert 409.
 */
account.post('/api/contribution', async (c) => {
  const userId = c.get('userId');
  const userRow = await c.env.DB.prepare('SELECT monthly_contribution FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ monthly_contribution: number }>();
  const contribution = userRow?.monthly_contribution ?? 0;
  if (contribution <= 0) {
    return c.json(
      { error: 'Kein Monatsbeitrag hinterlegt – bitte zuerst unter Einstellungen setzen' },
      422,
    );
  }

  const monthPrefix = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}%`;
  const existing = await c.env.DB.prepare(
    "SELECT id FROM transactions WHERE type = 'transfer' AND category = 'Beitrag' AND user_id = ?1 AND date LIKE ?2 LIMIT 1",
  )
    .bind(userId, monthPrefix)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ error: 'Dein Beitrag für diesen Monat ist bereits gebucht' }, 409);
  }

  await c.env.DB.prepare(
    "INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from) VALUES (?1, ?2, 'transfer', 'Beitrag', 'Monatsbeitrag Gemeinschaftskonto', ?3, 'shared', 'joint')",
  )
    .bind(userId, contribution, new Date().toISOString())
    .run();

  return c.json({ ok: true, amount: contribution }, 201);
});

/**
 * Ausgleichszahlung von `from` an `to` (beide Privatkonto, gleicher Haushalt)
 * oder Überweisung von `from` aufs Gemeinschaftskonto (`to: "joint"`).
 * `from`: "me" bzw. Nutzer-ID eines Haushaltsmitglieds.
 */
account.post('/api/settlements', async (c) => {
  const body = await c.req.json<{ amount?: unknown; from?: unknown; to?: unknown }>().catch(
    () => null,
  );
  const amount = toNumber(body?.amount, 0);
  if (amount <= 0) {
    return c.json({ error: 'amount muss eine Zahl größer 0 sein' }, 400);
  }

  const householdId = c.get('householdId');
  const myId = c.get('userId');

  const { results: members } = await c.env.DB
    .prepare('SELECT id, name FROM users WHERE household_id = ?1')
    .bind(householdId)
    .all<{ id: number; name: string }>();
  const byId = new Map(members.map((m) => [m.id, m]));

  const resolveId = (value: unknown): number | null => {
    if (value === 'me') return myId;
    const id = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isInteger(id) && byId.has(id) ? id : null;
  };

  // Ausgleichszahlungen dürfen nur im eigenen Namen gebucht werden –
  // sonst könnte jedes Mitglied Buchungen im Namen anderer anlegen.
  const fromId = resolveId(body?.from);
  if (fromId === null || fromId !== myId) {
    return c.json({ error: 'from muss "me" sein – Ausgleichszahlungen sind nur im eigenen Namen möglich' }, 400);
  }
  const fromName = byId.get(fromId)!.name;

  if (body?.to === 'joint') {
    const description = `Überweisung von ${fromName} aufs Gemeinschaftskonto`;
    await c.env.DB.prepare(
      "INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from) VALUES (?1, ?2, 'transfer', 'Überweisung', ?3, ?4, 'shared', 'joint')",
    )
      .bind(fromId, Math.round(amount * 100) / 100, description, new Date().toISOString())
      .run();
    return c.json({ ok: true, amount, description }, 201);
  }

  const toId = resolveId(body?.to);
  if (toId === null) {
    return c.json({ error: 'to muss ein Haushaltsmitglied oder "joint" sein' }, 400);
  }
  if (fromId === toId) {
    return c.json({ error: 'Zahlender und Empfänger dürfen nicht identisch sein' }, 400);
  }

  const toName = byId.get(toId)!.name;

  await c.env.DB.prepare(
    "INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from, counterpart_id) VALUES (?1, ?2, 'settlement', 'Ausgleich', ?3, ?4, 'shared', 'private', ?5)",
  )
    .bind(
      fromId,
      Math.round(amount * 100) / 100,
      `Ausgleichszahlung von ${fromName} an ${toName}`,
      new Date().toISOString(),
      toId,
    )
    .run();

  return c.json({ ok: true, amount, description: `Ausgleichszahlung von ${fromName} an ${toName}` }, 201);
});

export default account;
