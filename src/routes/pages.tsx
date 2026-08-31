import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import type { Env } from '../types';
import { COOKIE_NAME } from '../lib/auth';
import { LoginView } from '../views/login';
import { RegisterView } from '../views/register';
import { DashboardView, SummaryCards, TxList, type DashboardTx, type DebtRow } from '../views/dashboard';
import { RecurringList, RecurringView } from '../views/recurring';
import { StatsView } from '../views/stats';
import { SettingsView } from '../views/settings';
import { materializeRecurring, nextDueDate, todayBerlin, type RecurringRule } from '../lib/recurring';

const pages = new Hono<Env>();

type AuthInfo = { uid: number; hid: number; name: string; email: string };

/** Cookie-basierte Auth-Prüfung für Seiten: bei Misserfolg wird redirectet statt 401 JSON. */
async function getAuth(c: Context<Env>): Promise<AuthInfo | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    if (
      typeof payload.uid !== 'number' ||
      typeof payload.hid !== 'number' ||
      typeof payload.name !== 'string'
    ) {
      return null;
    }
    return {
      uid: payload.uid,
      hid: payload.hid,
      name: payload.name,
      email: String(payload.email ?? ''),
    };
  } catch {
    return null;
  }
}

function monthParam(value: string | undefined): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

const toNumber = (value: string | undefined, fallback = 0): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

pages.get('/', async (c) => c.redirect((await getAuth(c)) ? '/dashboard' : '/login'));

pages.get('/login', async (c) => {
  if (await getAuth(c)) return c.redirect('/dashboard');
  return c.html(<LoginView />);
});

pages.get('/register', async (c) => {
  if (await getAuth(c)) return c.redirect('/dashboard');
  const code = c.req.query('code') ?? '';
  return c.html(<RegisterView initialCode={code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()} />);
});

pages.get('/settings', async (c) => {
  const auth = await getAuth(c);
  if (!auth) return c.redirect('/login');

  const hid = auth.hid;
  const household = await c.env.DB
    .prepare('SELECT name, invite_code FROM households WHERE id = ?1')
    .bind(hid)
    .first<{ name: string; invite_code: string }>();
  const { results: members } = await c.env.DB
    .prepare(
      'SELECT id, name, monthly_contribution, is_admin FROM users WHERE household_id = ?1 ORDER BY id',
    )
    .bind(hid)
    .all<{ id: number; name: string; monthly_contribution: number; is_admin: number }>();
  const { results: settingRows } = await c.env.DB
    .prepare("SELECT value FROM settings WHERE household_id = ?1 AND key = 'joint_start_balance'")
    .bind(hid)
    .all<{ value: string }>();
  const me = members.find((m) => m.id === auth.uid);

  return c.html(
    <SettingsView
      userName={auth.name}
      userEmail={auth.email}
      householdName={household?.name ?? 'Haushalt'}
      inviteCode={household?.invite_code ?? ''}
      isAdmin={me?.is_admin === 1}
      members={members.map((m) => ({
        id: m.id,
        name: m.name,
        monthly_contribution: m.monthly_contribution,
        isAdmin: m.is_admin === 1,
      }))}
      myContribution={me?.monthly_contribution ?? 0}
      startBalance={toNumber(settingRows[0]?.value)}
    />,
  );
});

pages.get('/dashboard', async (c) => {
  const auth = await getAuth(c);
  if (!auth) return c.redirect('/login');

  const data = await loadDashboardData(c, auth, monthParam(c.req.query('month')));
  return c.html(<DashboardView {...data} />);
});

/** Statistik-Seite: Kategorien, 12-Monats-Verlauf, Top-Ausgaben. */
pages.get('/stats', async (c) => {
  const auth = await getAuth(c);
  if (!auth) return c.redirect('/login');

  const data = await loadStatsData(c, auth, monthParam(c.req.query('month')));
  return c.html(<StatsView {...data} />);
});

/** Eigene Seite „Wiederkehrende Zahlungen“: Regeln verwalten. */
pages.get('/recurring', async (c) => {
  const auth = await getAuth(c);
  if (!auth) return c.redirect('/login');

  const [data, household, memberCountRow] = await Promise.all([
    loadRecurringData(c, auth.hid, auth.uid),
    c.env.DB
      .prepare('SELECT name FROM households WHERE id = ?1')
      .bind(auth.hid)
      .first<{ name: string }>(),
    c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM users WHERE household_id = ?1')
      .bind(auth.hid)
      .first<{ n: number }>(),
  ]);
  return c.html(
    <RecurringView
      userName={auth.name}
      householdName={household?.name ?? 'Haushalt'}
      rules={data.rules}
      today={data.today}
      memberCount={Math.max(memberCountRow?.n ?? 1, 1)}
    />,
  );
});

/** Fragment der Regel-Liste auf der recurring-Seite. */
pages.get('/recurring/fragments/list', async (c) => {
  const auth = await requireDashboardAuth(c);
  if (auth instanceof Response) return auth;
  const data = await loadRecurringData(c, auth.hid, auth.uid);
  return c.html(<RecurringList rules={data.rules} />);
});

/**
 * HTML-Fragmente für Partial Updates: der Client tauscht nach Mutationen nur
 * diese Bereiche aus statt die ganze Seite neu zu laden. Für fetch-Aufrufe
 * (Header X-Fragments) wird bei fehlender Session 401 JSON geliefert statt
 * eines Redirects, damit der Client sauber reagieren kann.
 */

pages.get('/dashboard/fragments/summary', async (c) => {
  const auth = await requireDashboardAuth(c);
  if (auth instanceof Response) return auth;
  const data = await loadSummaryData(c, auth, monthParam(c.req.query('month')));
  return c.html(<SummaryCards {...data} />);
});

pages.get('/dashboard/fragments/list', async (c) => {
  const auth = await requireDashboardAuth(c);
  if (auth instanceof Response) return auth;
  // Der Client fragt nur die Variante an, die er tatsächlich anzeigt – das
  // List-Fragment transportiert dann nicht beide Repräsentationen.
  const layoutParam = c.req.query('layout');
  const layout = layoutParam === 'mobile' || layoutParam === 'desktop' ? layoutParam : undefined;
  const data = await loadListData(c, auth, monthParam(c.req.query('month')));
  return c.html(<TxList {...data} layout={layout} />);
});

/** Auth für Fragment- und Dashboard-Routen: bei Fehlen 401 JSON (Fetch) oder Redirect. */
async function requireDashboardAuth(c: Context<Env>): Promise<AuthInfo | Response> {
  const auth = await getAuth(c);
  if (!auth) {
    return c.req.header('X-Fragments')
      ? c.json({ error: 'Sitzung abgelaufen' }, 401)
      : c.redirect('/login');
  }
  return auth;
}

/** Daten für die Kopf-Karten inkl. Aktions-Buttons (Summary-Fragment). */
async function loadSummaryData(c: Context<Env>, auth: AuthInfo, month: string) {
  const hid = auth.hid;
  const uid = auth.uid;
  const prefix = `${month}%`;
  const currentPrefix = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}%`;

  // Lazy Materialization: fällige Occurrences wiederkehrender Zahlungen erzeugen
  await materializeRecurring(c.env.DB, hid);

  // Haushalt & Mitglieder
  const household = await c.env.DB
    .prepare('SELECT name, invite_code FROM households WHERE id = ?1')
    .bind(hid)
    .first<{ name: string; invite_code: string }>();
  const { results: members } = await c.env.DB
    .prepare('SELECT id, name FROM users WHERE household_id = ?1 ORDER BY id')
    .bind(hid)
    .all<{ id: number; name: string }>();
  const memberCount = members.length;

  // Einstellungen (pro Haushalt) + eigener Monatsbeitrag
  const { results: settingRows } = await c.env.DB
    .prepare('SELECT key, value FROM settings WHERE household_id = ?1')
    .bind(hid)
    .all<{ key: string; value: string }>();
  const settingsMap = new Map(settingRows.map((row) => [row.key, row.value]));
  const settings = {
    start: toNumber(settingsMap.get('joint_start_balance')),
  };
  const myContribution =
    (
      await c.env.DB.prepare('SELECT monthly_contribution FROM users WHERE id = ?1')
        .bind(uid)
        .first<{ monthly_contribution: number }>()
    )?.monthly_contribution ?? 0;

  // Karte 1: privater Saldo – private Einnahmen/Ausgaben, meine Beiträge, Ausgleiche
  const privateBalance =
    (
      await c.env.DB.prepare(
        `SELECT COALESCE(SUM(v), 0) AS bal FROM (
           SELECT CASE WHEN type = 'income' THEN amount ELSE -amount END AS v
           FROM transactions
           WHERE user_id = ?1 AND paid_from = 'private' AND type IN ('income', 'expense')
           UNION ALL
           SELECT -amount AS v FROM transactions WHERE user_id = ?1 AND type = 'transfer'
           UNION ALL
           SELECT CASE WHEN user_id = ?1 THEN -amount ELSE amount END AS v
           FROM transactions
           WHERE type = 'settlement' AND (user_id = ?1 OR counterpart_id = ?1)
         )`,
      )
        .bind(uid)
        .first<{ bal: number }>()
    )?.bal ?? 0;

  // Karte 2: Gemeinschaftskonto – Startstand + Beiträge − gemeinsame Ausgaben vom Konto
  const pot = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN t.type = 'transfer' THEN t.amount ELSE 0 END), 0) AS transfers,
       COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.paid_from = 'joint' THEN t.amount ELSE 0 END), 0) AS joint_expenses
     FROM transactions t
     WHERE t.user_id IN (SELECT id FROM users WHERE household_id = ?1)`,
  )
    .bind(hid)
    .first<{ transfers: number; joint_expenses: number }>();
  const jointPot = {
    saldo: Math.round((settings.start + (pot?.transfers ?? 0) - (pot?.joint_expenses ?? 0)) * 100) / 100,
    start: settings.start,
    transfers: pot?.transfers ?? 0,
  };

  // Karte 3: gemeinsame Ausgaben im Monat, aufgeteilt nach Bezahltkonto
  const sharedMonthRow = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN paid_from = 'joint' THEN amount ELSE 0 END), 0) AS from_joint,
       COALESCE(SUM(CASE WHEN paid_from = 'private' THEN amount ELSE 0 END), 0) AS advanced
     FROM transactions
     WHERE scope = 'shared' AND type = 'expense' AND date LIKE ?2
       AND user_id IN (SELECT id FROM users WHERE household_id = ?1)`,
  )
    .bind(hid, prefix)
    .first<{ from_joint: number; advanced: number }>();
  const sharedMonth = {
    total: Math.round(((sharedMonthRow?.from_joint ?? 0) + (sharedMonthRow?.advanced ?? 0)) * 100) / 100,
    advanced: sharedMonthRow?.advanced ?? 0,
  };

  // Karte 4: paarweise Schulden – private Vorschüsse gleicheilig 1/N umgelegt,
  // reduziert um Ausgleichszahlungen zwischen dem Paar
  const { results: advanceRows } = await c.env.DB
    .prepare(
      `SELECT u.id, u.name, COALESCE(SUM(t.amount), 0) AS adv
       FROM users u
       LEFT JOIN transactions t
         ON t.user_id = u.id AND t.scope = 'shared' AND t.type = 'expense' AND t.paid_from = 'private'
       WHERE u.household_id = ?1
       GROUP BY u.id, u.name`,
    )
    .bind(hid)
    .all<{ id: number; name: string; adv: number }>();
  const advByMember = new Map(advanceRows.map((row) => [row.id, row.adv]));
  const myAdvances = advByMember.get(uid) ?? 0;

  const { results: mySettlements } = await c.env.DB
    .prepare(
      'SELECT user_id, counterpart_id, amount FROM transactions WHERE type = \'settlement\' AND (user_id = ?1 OR counterpart_id = ?1)',
    )
    .bind(uid)
    .all<{ user_id: number; counterpart_id: number | null; amount: number }>();
  const settledByMe = new Map<number, number>(); // ich habe an X gezahlt
  const settledToMe = new Map<number, number>(); // X hat an mich gezahlt
  for (const row of mySettlements) {
    if (row.user_id === uid && row.counterpart_id !== null) {
      settledByMe.set(row.counterpart_id, (settledByMe.get(row.counterpart_id) ?? 0) + row.amount);
    } else if (row.counterpart_id === uid) {
      settledToMe.set(row.user_id, (settledToMe.get(row.user_id) ?? 0) + row.amount);
    }
  }

  const debts: DebtRow[] = [];
  for (const member of members) {
    if (member.id === uid) continue;
    const net =
      ((advByMember.get(member.id) ?? 0) - myAdvances) / memberCount -
      (settledByMe.get(member.id) ?? 0) +
      (settledToMe.get(member.id) ?? 0);
    const rounded = Math.round(net * 100) / 100;
    if (Math.abs(rounded) < 0.01) continue;
    debts.push({
      otherId: member.id,
      other: member.name,
      kind: rounded > 0 ? 'you-owe' : 'owed-to-you',
      amount: Math.abs(rounded),
    });
  }
  debts.sort((a, b) => b.amount - a.amount);

  // Schnellbutton: eigener Beitrag für den aktuellen Monat schon gebucht?
  const contributionBooked =
    myContribution > 0 &&
    (
      await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM transactions WHERE type = 'transfer' AND category = 'Beitrag' AND user_id = ?1 AND date LIKE ?2",
      )
        .bind(uid, currentPrefix)
        .first<{ n: number }>()
    )?.n! > 0;

  return {
    userName: auth.name,
    householdName: household?.name ?? 'Haushalt',
    members,
    monthLabel: monthLabelFor(month),
    privateBalance,
    jointPot,
    sharedMonth,
    debts,
    myContribution,
    contributionBooked,
  };
}

/** Daten für die Transaktionsliste inkl. Monatsnavi (List-Fragment). */
async function loadListData(c: Context<Env>, auth: AuthInfo, month: string) {
  const hid = auth.hid;
  const prefix = `${month}%`;

  // Lazy Materialization (idempotent, INSERT OR IGNORE) – auch der reine
  // Listen-Fragment-Abruf erzeugt fällige wiederkehrende Buchungen
  await materializeRecurring(c.env.DB, hid);

  // Historie des Haushalts im gewählten Monat – persönliche Buchungen anderer
  // Mitglieder bleiben ausgeblendet, nur eigene + gemeinsame sind sichtbar
  const { results: transactions } = await c.env.DB.prepare(
    `SELECT t.id, u.name AS created_by, t.amount, t.type, t.category, t.description, t.date, t.scope, t.paid_from, t.recurring_id
     FROM transactions t
     JOIN users u ON u.id = t.user_id
     WHERE u.household_id = ?1 AND t.date LIKE ?2 AND (t.scope = 'shared' OR t.user_id = ?3)
     ORDER BY t.date DESC, t.id DESC
     LIMIT 100`,
  )
    .bind(hid, prefix, auth.uid)
    .all<DashboardTx>();

  return {
    monthLabel: monthLabelFor(month),
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    transactions,
    today: new Date().toISOString().slice(0, 10),
  };
}

/** Daten für die Sektion „Wiederkehrende Zahlungen“ (Recurring-Fragment). */
async function loadRecurringData(c: Context<Env>, hid: number, uid: number) {
  const { results: rules } = await c.env.DB
    .prepare(
      "SELECT * FROM recurring_rules WHERE household_id = ?1 AND (scope = 'shared' OR user_id = ?2) ORDER BY active DESC, id ASC",
    )
    .bind(hid, uid)
    .all<RecurringRule>();
  const today = todayBerlin();

  const rulesWithNextDue = await Promise.all(
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

  return { rules: rulesWithNextDue, today };
}

/** Daten für die Statistik-Seite. */
async function loadStatsData(c: Context<Env>, auth: AuthInfo, month: string) {
  const hid = auth.hid;
  const prefix = `${month}%`;
  // 6-Monats-Fenster: vom ersten Tag des Monats vor 5 Monaten bis Monatsende
  const windowStart = `${shiftMonth(month, -5)}-01`;

  await materializeRecurring(c.env.DB, hid);

  const [household, categorySplitResult, historyResult, topResult, membersResult] = await Promise.all([
    c.env.DB
      .prepare('SELECT name FROM households WHERE id = ?1')
      .bind(hid)
      .first<{ name: string }>(),
    c.env.DB
      .prepare(
        `SELECT t.category AS category,
                COALESCE(SUM(CASE WHEN t.paid_from = 'joint' OR (t.scope = 'shared' AND t.paid_from = 'private') THEN t.amount ELSE 0 END), 0) AS shared,
                COALESCE(SUM(CASE WHEN t.paid_from = 'joint' OR (t.scope = 'shared' AND t.paid_from = 'private') THEN 0 ELSE t.amount END), 0) AS own
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE u.household_id = ?1 AND t.type = 'expense' AND t.date LIKE ?2 AND (t.scope = 'shared' OR t.user_id = ?3)
         GROUP BY t.category`,
      )
      .bind(hid, prefix, auth.uid)
      .all<{ category: string; shared: number; own: number }>(),
    c.env.DB
      .prepare(
        `SELECT substr(t.date, 1, 7) AS ym,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount END), 0) AS expense
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE u.household_id = ?1 AND t.type IN ('income', 'expense') AND t.date >= ?2 AND (t.scope = 'shared' OR t.user_id = ?3)
         GROUP BY ym`,
      )
      .bind(hid, `${windowStart}T00:00:00.000Z`, auth.uid)
      .all<{ ym: string; income: number; expense: number }>(),
    c.env.DB
      .prepare(
        `SELECT t.description, t.category, t.amount, t.date, u.name AS created_by
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE u.household_id = ?1 AND t.type = 'expense' AND t.date LIKE ?2 AND (t.scope = 'shared' OR t.user_id = ?3)
         ORDER BY t.amount DESC
         LIMIT 10`,
      )
      .bind(hid, prefix, auth.uid)
      .all<{ description: string; category: string; amount: number; date: string; created_by: string }>(),
    c.env.DB
      .prepare('SELECT id, name FROM users WHERE household_id = ?1 ORDER BY id')
      .bind(hid)
      .all<{ id: number; name: string }>(),
  ]);
  const historyRows = historyResult.results;
  const topRows = topResult.results;

  const memberCount = Math.max(membersResult.results.length, 1);

  // Lücken im 6-Monats-Fenster mit 0 auffüllen (für die Balken-X-Achse)
  const historyByMonth = new Map(historyRows.map((row) => [row.ym, row]));
  const history: { ym: string; income: number; expense: number }[] = [];
  for (let i = -5; i <= 0; i++) {
    const ym = shiftMonth(month, i);
    const row = historyByMonth.get(ym);
    history.push({
      ym,
      income: row ? Math.round(row.income * 100) / 100 : 0,
      expense: row ? Math.round(row.expense * 100) / 100 : 0,
    });
  }

  // Kategorien: persönliche Ausgaben voll, Gemeinschaftsausgaben (Gemeinschaftskonto
  // oder private Vorschüsse) gleichmäßig 1/N auf alle Mitglieder verteilt (Pro-Kopf-Sicht)
  const categories = categorySplitResult.results
    .map((row) => ({
      category: row.category,
      spent: Math.round((row.own + row.shared / memberCount) * 100) / 100,
    }))
    .sort((a, b) => b.spent - a.spent);
  const categoryTotal =
    Math.round(categorySplitResult.results.reduce((sum, row) => sum + row.own + row.shared, 0) * 100) / 100;

  return {
    userName: auth.name,
    householdName: household?.name ?? 'Haushalt',
    month,
    monthLabel: monthLabelFor(month),
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    categories,
    categoryTotal,
    history,
    topExpenses: topRows,
  };
}

function monthLabelFor(month: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Kompletter Dashboard-Datensatz für die ganzseitige Ansicht. */
async function loadDashboardData(c: Context<Env>, auth: AuthInfo, month: string) {
  const [summary, list, recurringCount] = await Promise.all([
    loadSummaryData(c, auth, month),
    loadListData(c, auth, month),
    c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM recurring_rules WHERE household_id = ?1')
      .bind(auth.hid)
      .first<{ n: number }>(),
  ]);
  return { ...summary, ...list, recurringCount: recurringCount?.n ?? 0, month };
}

export default pages;
