import { Hono } from 'hono';
import type { Env } from './types';
import { hashPassword } from './lib/password';
import { generateInviteCode } from './lib/invite';
import authRoutes from './routes/auth';
import transactionRoutes from './routes/transactions';
import magicRoutes from './routes/magic';
import accountRoutes from './routes/account';
import meRoutes from './routes/me';
import registerRoutes from './routes/register';
import recurringRoutes from './routes/recurring';
import pageRoutes from './routes/pages';
import { materializeRecurring } from './lib/recurring';

const app = new Hono<Env>();

app.route('/', pageRoutes);
app.route('/', authRoutes);
app.route('/', registerRoutes);
app.route('/', transactionRoutes);
app.route('/', magicRoutes);
app.route('/', accountRoutes);
app.route('/', meRoutes);
app.route('/', recurringRoutes);
app.route('/', pageRoutes);

app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    return c.json({ status: 'error', db: 'unavailable', detail: (e as Error).message }, 500);
  }
});

const DEMO_PASSWORD = 'demo1234';

const DEMO_USERS = [
  { name: 'Anna', email: 'anna@smartwallet.app' },
  { name: 'Ben', email: 'ben@smartwallet.app' },
] as const;

app.post('/api/dev/seed', async (c) => {
  // Produktionssicherung: der Endpoint legt Demo-Logins mit bekanntem
  // Passwort an und ist deshalb nur mit explizit gesetztem Flag erreichbar
  if (!c.env.ENABLE_DEV_SEED) {
    return c.json({ error: 'Not Found' }, 404);
  }

  // 1) Demo-Haushalt anlegen
  const inviteCode = generateInviteCode();
  await c.env.DB.prepare('INSERT INTO households (name, invite_code) VALUES (?1, ?2)')
    .bind('Muster-Haushalt', inviteCode)
    .run();
  // ID zuverlässig über den eindeutigen Code nachlesen
  // (meta.last_row_id ist auf remote D1 nicht verlässlich gefüllt)
  const householdRow = await c.env.DB
    .prepare('SELECT id FROM households WHERE invite_code = ?1')
    .bind(inviteCode)
    .first<{ id: number }>();
  if (!householdRow) {
    return c.json({ error: 'Seed-Haushalt konnte nicht angelegt werden' }, 500);
  }
  const householdId = householdRow.id;

  // 2) Demo-Nutzer (Passwort für beide: demo1234), eigener Monatsbeitrag je 700 €
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of DEMO_USERS) {
    await c.env.DB.prepare(
      'INSERT INTO users (household_id, name, email, password_hash, is_admin, monthly_contribution) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(
        householdId,
        user.name,
        user.email,
        passwordHash,
        user.email.startsWith('anna') ? 1 : 0,
        700,
      )
      .run();
  }

  // 3) Einstellungen für den Demo-Haushalt
  const defaults = [{ key: 'joint_start_balance', value: '500' }];
  const settingStmt = c.env.DB.prepare(
    'INSERT INTO settings (household_id, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(household_id, key) DO NOTHING',
  );
  await c.env.DB.batch(defaults.map((d) => settingStmt.bind(householdId, d.key, d.value)));

  const { results: userRows } = await c.env.DB
    .prepare('SELECT id, name FROM users WHERE household_id = ?1')
    .bind(householdId)
    .all<{ id: number; name: string }>();
  const userIdByName = new Map(userRows.map((u) => [u.name, u.id]));
  const annaId = userIdByName.get('Anna');
  const benId = userIdByName.get('Ben');
  if (annaId === undefined || benId === undefined) {
    return c.json({ error: 'Seed-Nutzer konnten nicht angelegt werden' }, 500);
  }

  // 4) Demo-Transaktionen nur einmalig seeden (Tabelle muss leer sein)
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM transactions').first<{
    n: number;
  }>();
  if ((count?.n ?? 0) > 0) {
    return c.json({
      status: 'already-seeded',
      users: userRows.length,
      transactions: count?.n,
    });
  }

  const now = new Date();
  // Tage ≤ 21, damit der Seed auch am Monatsanfang nie in der Zukunft liegt
  const iso = (day: number, hour: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour)).toISOString();

  // Modell: Beiträge je 700 € (Settings), Miete/Strom/Einkauf vom Gemeinskonto,
  // Pizza/Essen/Drogerie privat vorgestreckt → Ben schuldet Anna (60−80)/2 …
  // genauer: Anna 60 € Vorschuss, Ben 80 € Vorschuss → Anna schuldet Ben 10 €
  const demoTransactions = [
    { userId: annaId, amount: 2500, type: 'income', category: 'Einnahme', description: 'Monatsgehalt Anna', date: iso(1, 8), scope: 'personal', paidFrom: 'private' },
    { userId: benId, amount: 2200, type: 'income', category: 'Einnahme', description: 'Monatsgehalt Ben', date: iso(1, 8), scope: 'personal', paidFrom: 'private' },
    { userId: annaId, amount: 700, type: 'transfer', category: 'Beitrag', description: 'Monatsbeitrag Gemeinschaftskonto', date: iso(1, 9), scope: 'shared', paidFrom: 'joint' },
    { userId: benId, amount: 700, type: 'transfer', category: 'Beitrag', description: 'Monatsbeitrag Gemeinschaftskonto', date: iso(1, 9), scope: 'shared', paidFrom: 'joint' },
    { userId: annaId, amount: 900, type: 'expense', category: 'Wohnen', description: 'Miete', date: iso(3, 9), scope: 'shared', paidFrom: 'joint' },
    { userId: benId, amount: 80, type: 'expense', category: 'Wohnen', description: 'Stromabschlag', date: iso(5, 9), scope: 'shared', paidFrom: 'joint' },
    { userId: annaId, amount: 100, type: 'expense', category: 'Essen & Trinken', description: 'Wocheneinkauf', date: iso(6, 18), scope: 'shared', paidFrom: 'joint' },
    { userId: benId, amount: 50, type: 'expense', category: 'Essen & Trinken', description: 'Pizzaabend', date: iso(8, 20), scope: 'shared', paidFrom: 'private' },
    { userId: annaId, amount: 45, type: 'expense', category: 'Mobilität', description: 'Auto betankt', date: iso(12, 9), scope: 'personal', paidFrom: 'private' },
    { userId: annaId, amount: 60, type: 'expense', category: 'Essen & Trinken', description: 'Essen zu zweit', date: iso(15, 19), scope: 'shared', paidFrom: 'private' },
    { userId: benId, amount: 30, type: 'expense', category: 'Gesundheit & Körper', description: 'Drogerie-Einkauf', date: iso(18, 17), scope: 'shared', paidFrom: 'private' },
    { userId: annaId, amount: 15, type: 'expense', category: 'Freizeit & Sonstiges', description: 'Musik-Abo', date: iso(21, 10), scope: 'personal', paidFrom: 'private' },
  ] as const;

  const insert = c.env.DB.prepare(
    'INSERT INTO transactions (user_id, amount, type, category, description, date, scope, paid_from) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
  );
  await c.env.DB.batch(
    demoTransactions.map((t) =>
      insert.bind(
        t.userId,
        t.amount,
        t.type,
        t.category,
        t.description,
        t.date,
        t.scope,
        t.paidFrom,
      ),
    ),
  );

  return c.json({
    status: 'seeded',
    household: { name: 'Muster-Haushalt', invite_code: inviteCode },
    users: DEMO_USERS.map(({ name, email }) => ({ name, email })),
    transactions: demoTransactions.length,
    settings: { joint_start_balance: 500 },
    demoLogin: { email: 'anna@smartwallet.app', password: DEMO_PASSWORD },
  });
});

// Täglicher Cron (wrangler.toml [triggers]): materialisiert fällige Occurrences
// wiederkehrender Zahlungen auch dann, wenn niemand das Dashboard aufruft.
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env['Bindings'], ctx: ExecutionContext) => {
    const { results: households } = await env.DB
      .prepare('SELECT id FROM households')
      .all<{ id: number }>();
    const CONCURRENCY = 5;
    for (let i = 0; i < households.length; i += CONCURRENCY) {
      await Promise.all(
        households.slice(i, i + CONCURRENCY).map((household) => materializeRecurring(env.DB, household.id)),
      );
    }
  },
};
