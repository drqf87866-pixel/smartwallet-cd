import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * API-Integrationstests gegen den echten Worker (SELF.fetch) mit D1.
 * Ablauf ist sequenziell: Registrierung zweier Haushalte liefert die
 * Cookies für alle folgenden Aufrufe.
 */

const BASE = 'https://smartwallet.test';

type BudgetRow = { month: string; category: string; amount: number };

/** json() liefert in den Workers-Typen unknown – hier zentral typisiert. */
function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const pair = setCookie.split(';')[0];
  expect(pair).toMatch(/^sw_token=/);
  return pair;
}

async function register(body: Record<string, unknown>): Promise<{ status: number; data: any; cookie: string }> {
  const res = await SELF.fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: res.headers.get('set-cookie') ? cookieFrom(res) : '' };
}

const anna = { mode: 'create', name: 'Anna', email: 'anna@test.example', password: 'anna-passwort-1', household_name: 'Test-Haushalt' };
const caro = { mode: 'create', name: 'Caro', email: 'caro@test.example', password: 'caro-passwort-1', household_name: 'Fremder Haushalt' };
let ben: Record<string, unknown> = { mode: 'join', name: 'Ben', email: 'ben@test.example', password: 'ben-passwort-1' };

let annaCookie = '';
let benCookie = '';
let caroCookie = '';
let annaTxId = 0;

describe('Health & Registrierung', () => {
  it('/api/health meldet D1-Verbindung', async () => {
    const res = await SELF.fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'connected' });
  });

  it('Haushalt erstellen → 201, Auto-Login-Cookie, Einladungscode', async () => {
    const { status, data, cookie } = await register(anna);
    expect(status).toBe(201);
    expect(data.user).toMatchObject({ name: 'Anna', email: 'anna@test.example' });
    expect(data.household.invite_code).toMatch(/^[A-Z2-9]{8}$/);
    expect(cookie).toContain('sw_token=');
    annaCookie = cookie;
    ben.invite_code = data.household.invite_code;
  });

  it('per Einladungscode beitreten → Mitglied desselben Haushalts', async () => {
    const { status, data, cookie } = await register(ben);
    expect(status).toBe(201);
    expect(data.household.name).toBe('Test-Haushalt');
    benCookie = cookie;
  });

  it('zweiter, unabhängiger Haushalt für Scoping-Tests', async () => {
    const { status, cookie } = await register(caro);
    expect(status).toBe(201);
    caroCookie = cookie;
  });

  it('doppelte E-Mail wird abgelehnt', async () => {
    const { status } = await register({ ...anna });
    expect(status).toBe(409);
  });
});

describe('Login', () => {
  it('falsches Passwort → 401 mit einheitlicher Meldung', async () => {
    const res = await SELF.fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'anna@test.example', password: 'falsch' }),
    });
    expect(res.status).toBe(401);
    expect((await json<{ error: string }>(res)).error).toBe('E-Mail oder Passwort ist falsch');
  });

  it('korrektes Passwort → 200 mit Cookie', async () => {
    const res = await SELF.fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'anna@test.example', password: 'anna-passwort-1' }),
    });
    expect(res.status).toBe(200);
    annaCookie = cookieFrom(res);
  });
});

describe('Transaktionen', () => {
  it('gemeinsame Ausgabe anlegen → 201, in Historie sichtbar', async () => {
    const res = await SELF.fetch(`${BASE}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ amount: 42.5, type: 'expense', scope: 'shared', paid_from: 'joint', category: 'Lebensmittel', description: 'Wocheneinkauf' }),
    });
    expect(res.status).toBe(201);
    const { transaction } = await json<{ transaction: { created_by: string } }>(res);
    expect(transaction.created_by).toBe('Anna');

    // Die POST-Antwort enthält keine DB-id – die ID aus der Historie ermitteln
    const list = await SELF.fetch(`${BASE}/api/transactions`, { headers: { Cookie: annaCookie } });
    const { transactions } = await json<{ transactions: { id: number; description: string }[] }>(list);
    const created = transactions.find((t) => t.description === 'Wocheneinkauf');
    expect(created).toBeDefined();
    annaTxId = created!.id;
  });

  it('Validierung: unbekannte Kategorie → 400, reservierte Kategorie → 400', async () => {
    const bad = await SELF.fetch(`${BASE}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ amount: 5, type: 'expense', scope: 'shared', category: 'Freitext' }),
    });
    expect(bad.status).toBe(400);

    const beitrag = await SELF.fetch(`${BASE}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ amount: 5, type: 'expense', scope: 'shared', category: 'Beitrag' }),
    });
    expect(beitrag.status).toBe(400);
  });

  it('ohne Session → 401 (requireAuth)', async () => {
    const res = await SELF.fetch(`${BASE}/api/transactions`);
    expect(res.status).toBe(401);
  });
});

describe('Budgets', () => {
  it('Standard-Budget setzen und auslesen', async () => {
    const put = await SELF.fetch(`${BASE}/api/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ month: 'default', category: 'Lebensmittel', amount: 400 }),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch(`${BASE}/api/budgets`, { headers: { Cookie: annaCookie } });
    const { budgets } = await json<{ budgets: BudgetRow[] }>(get);
    expect(budgets).toContainEqual({ month: 'default', category: 'Lebensmittel', amount: 400 });
  });

  it('monatsspezifisches Budget überschreibt den Standard per Effektiv-Logik (API speichert beide)', async () => {
    const put = await SELF.fetch(`${BASE}/api/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ month: '2026-09', category: 'Restaurant', amount: 120 }),
    });
    expect(put.status).toBe(200);

    const get = await SELF.fetch(`${BASE}/api/budgets`, { headers: { Cookie: annaCookie } });
    const { budgets } = await json<{ budgets: BudgetRow[] }>(get);
    expect(budgets).toContainEqual({ month: '2026-09', category: 'Restaurant', amount: 120 });
  });

  it('amount 0 löscht das Budget', async () => {
    await SELF.fetch(`${BASE}/api/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ month: '2026-09', category: 'Restaurant', amount: 0 }),
    });
    const get = await SELF.fetch(`${BASE}/api/budgets`, { headers: { Cookie: annaCookie } });
    const { budgets } = await json<{ budgets: BudgetRow[] }>(get);
    expect(budgets.some((b) => b.category === 'Restaurant')).toBe(false);
  });

  it('ungültige Eingaben → 400 (reservierte Kategorie, falsches Monatsformat)', async () => {
    const badCat = await SELF.fetch(`${BASE}/api/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ month: 'default', category: 'Beitrag', amount: 50 }),
    });
    expect(badCat.status).toBe(400);

    const badMonth = await SELF.fetch(`${BASE}/api/budgets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({ month: '09-2026', category: 'Café', amount: 50 }),
    });
    expect(badMonth.status).toBe(400);
  });

  it('Batch-Endpoint setzt mehrere Budgets in einem Request', async () => {
    const res = await SELF.fetch(`${BASE}/api/budgets/batch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({
        changes: [
          { month: 'default', category: 'Transport', amount: 150 },
          { month: 'default', category: 'Café', amount: 80 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await json<{ ok: boolean; count: number }>(res)).toMatchObject({ ok: true, count: 2 });

    const get = await SELF.fetch(`${BASE}/api/budgets`, { headers: { Cookie: annaCookie } });
    const { budgets } = await json<{ budgets: BudgetRow[] }>(get);
    expect(budgets).toContainEqual({ month: 'default', category: 'Transport', amount: 150 });
    expect(budgets).toContainEqual({ month: 'default', category: 'Café', amount: 80 });
  });
});

describe('Dashboard-Fragmente', () => {
  it('Summary- und List-Fragment liefern konsistente HTML-Antworten', async () => {
    const headers = { Cookie: annaCookie, 'X-Fragments': '1' };
    const month = '2026-08';
    const [summaryRes, listRes] = await Promise.all([
      SELF.fetch(`${BASE}/dashboard/fragments/summary?month=${month}`, { headers }),
      SELF.fetch(`${BASE}/dashboard/fragments/list?month=${month}&layout=mobile`, { headers }),
    ]);
    expect(summaryRes.status).toBe(200);
    expect(listRes.status).toBe(200);
    const listHtml = await listRes.text();
    expect(listHtml).toContain('data-tx-cache');
    expect(listHtml).not.toMatch(/data-tx="\{/);
  });
});

describe('Passwort-Reset (Admin)', () => {
  let benId = 0;

  it('Nicht-Admin darf nicht zurücksetzen → 403', async () => {
    // Bens eigene ID via Login-Rückgabe? Registrierung lieferte user.id – hier über DB
    const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?1')
      .bind('ben@test.example')
      .first<{ id: number }>();
    benId = row!.id;
    const res = await SELF.fetch(`${BASE}/api/household/members/${benId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: benCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('Admin setzt Passwort → einmaliges Temp-Passwort, Login damit möglich', async () => {
    const res = await SELF.fetch(`${BASE}/api/household/members/${benId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const { temp_password } = await json<{ temp_password: string }>(res);
    expect(temp_password).toMatch(/^[A-Za-z0-9]{12}$/);

    const login = await SELF.fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ben@test.example', password: temp_password }),
    });
    expect(login.status).toBe(200);
    benCookie = cookieFrom(login);
  });

  it('fremdes Mitglied (anderer Haushalt) ist nicht erreichbar → 404', async () => {
    const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?1')
      .bind('caro@test.example')
      .first<{ id: number }>();
    const res = await SELF.fetch(`${BASE}/api/household/members/${row!.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: annaCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

describe('Haushalts-Scoping', () => {
  it('fremder Haushalt sieht die Transaktion nicht in der Historie', async () => {
    const list = await SELF.fetch(`${BASE}/api/transactions`, { headers: { Cookie: caroCookie } });
    const { transactions } = await json<{ transactions: { id: number }[] }>(list);
    expect(transactions.some((t) => t.id === annaTxId)).toBe(false);
  });

  it('fremder Haushalt erhält 404 beim Bearbeiten', async () => {
    const res = await SELF.fetch(`${BASE}/api/transactions/${annaTxId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: caroCookie },
      body: JSON.stringify({ amount: 1, type: 'expense', scope: 'shared', category: 'Café' }),
    });
    expect(res.status).toBe(404);
  });

  it('Budgets sind haushaltsisoliert', async () => {
    const get = await SELF.fetch(`${BASE}/api/budgets`, { headers: { Cookie: caroCookie } });
    const { budgets } = await json<{ budgets: BudgetRow[] }>(get);
    expect(budgets).toEqual([]);
  });
});

describe('CSV-Export', () => {
  it('liefert CSV mit BOM, Header und allen sichtbaren Buchungen', async () => {
    const res = await SELF.fetch(`${BASE}/api/export.csv`, { headers: { Cookie: annaCookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const csv = await res.text();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe('Datum;Art;Bereich;Konto;Kategorie;Beschreibung;Betrag;Erstellt von;Regel-ID');
    expect(csv).toContain('Wocheneinkauf');
    // Deutsch-Excel-Betrag mit Komma
    expect(csv).toContain('42,50');
  });

  it('ohne Session → 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/export.csv`);
    expect(res.status).toBe(401);
  });
});
