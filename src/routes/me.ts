import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/password';
import { generateInviteCode } from '../lib/invite';
import { enforceRateLimit } from '../lib/ratelimit';

const me = new Hono<Env>();

me.use('/api/me/*', requireAuth);
me.use('/api/household/*', requireAuth);

/** Alphabet ohne leicht verwechselbare Zeichen (l/I/1, O/0) für Temp-Passwörter. */
const TEMP_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTempPassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * Eigener Monatsbeitrag des angemeldeten Mitglieds – ersetzt den
 * früheren haushaltsweiten Fixbetrag. Wird per „Beitrag buchen“ als
 * Transfer aufs Gemeinschaftskonto gebucht.
 */
me.put('/api/me/contribution', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const raw = body?.amount;
  const amount =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw.replace(',', '.'))
        : NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    return c.json({ error: 'amount muss eine Zahl ≥ 0 sein' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET monthly_contribution = ?1 WHERE id = ?2')
    .bind(Math.round(amount * 100) / 100, c.get('userId'))
    .run();

  return c.json({ ok: true, amount: Math.round(amount * 100) / 100 });
});

/**
 * Passwort ändern: aktuelles Passwort verifizieren, dann neu hashen.
 * Die laufende Sitzung bleibt gültig (JWT hängt nicht am Passwort).
 */
me.put('/api/me/password', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const current = typeof body?.current_password === 'string' ? body.current_password : '';
  const next = typeof body?.new_password === 'string' ? body.new_password : '';
  if (!current || !next) {
    return c.json({ error: 'Bitte aktuelles und neues Passwort angeben' }, 400);
  }
  if (next.length < 8) {
    return c.json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1')
    .bind(c.get('userId'))
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return c.json({ error: 'Das aktuelle Passwort ist nicht korrekt' }, 400);
  }

  await c.env.DB.prepare('UPDATE users SET password_hash = ?1 WHERE id = ?2')
    .bind(await hashPassword(next), c.get('userId'))
    .run();

  return c.json({ ok: true });
});

/**
 * Haushaltsverwaltung – nur für den Haushaltsersteller (is_admin).
 * Der Einladungslink wird per „Neu generieren“ rotiert, alte Links sind
 * danach ungültig. Mitglieder können nach Ausgleich aller Salden entfernt
 * werden; deren Buchungen und wiederkehrende Zahlungen werden mitgelöscht.
 */

/** Prüft, ob das Ziel-Mitglied offene paarweise Salden hat (Logik wie Dashboard-Karte 4). */
async function hasOpenBalance(
  db: Env['Bindings']['DB'],
  householdId: number,
  targetId: number,
  memberCount: number,
): Promise<boolean> {
  // Private Vorschüsse für gemeinsame Ausgaben je Mitglied
  const { results: advanceRows } = await db
    .prepare(
      `SELECT u.id, COALESCE(SUM(t.amount), 0) AS adv
       FROM users u
       LEFT JOIN transactions t
         ON t.user_id = u.id AND t.scope = 'shared' AND t.type = 'expense' AND t.paid_from = 'private'
       WHERE u.household_id = ?1
       GROUP BY u.id`,
    )
    .bind(householdId)
    .all<{ id: number; adv: number }>();
  const advByMember = new Map(advanceRows.map((row) => [row.id, row.adv]));

  // Ausgleichszahlungen zwischen Ziel und anderen Mitgliedern
  // (Netto je Gegenüber, positiv = Ziel hat Geld erhalten)
  const { results: settlementRows } = await db
    .prepare(
      "SELECT user_id, counterpart_id, amount FROM transactions WHERE type = 'settlement' AND (user_id = ?1 OR counterpart_id = ?1)",
    )
    .bind(targetId)
    .all<{ user_id: number; counterpart_id: number | null; amount: number }>();
  const settledNet = new Map<number, number>();
  for (const row of settlementRows) {
    if (row.user_id === targetId && row.counterpart_id !== null) {
      settledNet.set(row.counterpart_id, (settledNet.get(row.counterpart_id) ?? 0) - row.amount);
    } else if (row.counterpart_id === targetId) {
      settledNet.set(row.user_id, (settledNet.get(row.user_id) ?? 0) + row.amount);
    }
  }

  const { results: others } = await db
    .prepare('SELECT id FROM users WHERE household_id = ?1 AND id != ?2')
    .bind(householdId, targetId)
    .all<{ id: number }>();
  const targetAdv = advByMember.get(targetId) ?? 0;
  for (const other of others) {
    const net =
      ((advByMember.get(other.id) ?? 0) - targetAdv) / memberCount - (settledNet.get(other.id) ?? 0);
    if (Math.abs(Math.round(net * 100) / 100) >= 0.01) return true;
  }
  return false;
}

/** Einladungslink neu generieren: rotiert den Code, alte Links werden ungültig. */
me.put('/api/household/invite', async (c) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Nur der Haushaltsersteller kann den Einladungslink neu generieren' }, 403);
  }

  let inviteCode = '';
  let updated = false;
  for (let attempt = 0; attempt < 3 && !updated; attempt++) {
    inviteCode = generateInviteCode();
    try {
      await c.env.DB.prepare('UPDATE households SET invite_code = ?1 WHERE id = ?2')
        .bind(inviteCode, c.get('householdId'))
        .run();
      updated = true;
    } catch {
      // UNIQUE-Kollision → neuer Code
    }
  }
  if (!updated) {
    return c.json({ error: 'Einladungslink konnte nicht neu generiert werden' }, 500);
  }

  return c.json({ ok: true, invite_code: inviteCode });
});

/** Mitglied aus dem Haushalt entfernen (nur Ersteller, keine offenen Salden). */
me.delete('/api/household/members/:id', async (c) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Nur der Haushaltsersteller kann Mitglieder entfernen' }, 403);
  }
  const hid = c.get('householdId');
  const myId = c.get('userId');
  const targetId = Number(c.req.param('id'));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: 'Ungültige Mitglieds-ID' }, 400);
  }
  if (targetId === myId) {
    return c.json({ error: 'Du kannst dich nicht selbst entfernen' }, 400);
  }

  const target = await c.env.DB
    .prepare('SELECT id, name, is_admin FROM users WHERE id = ?1 AND household_id = ?2')
    .bind(targetId, hid)
    .first<{ id: number; name: string; is_admin: number }>();
  if (!target) {
    return c.json({ error: 'Mitglied nicht gefunden' }, 404);
  }
  if (target.is_admin === 1) {
    return c.json({ error: 'Der Haushaltsersteller kann nicht entfernt werden' }, 400);
  }

  const countRow = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM users WHERE household_id = ?1')
    .bind(hid)
    .first<{ n: number }>();
  const memberCount = Math.max(countRow?.n ?? 1, 1);

  if (await hasOpenBalance(c.env.DB, hid, targetId, memberCount)) {
    return c.json(
      { error: `${target.name} hat offene Ausgleiche – bitte erst alle Ausgleichszahlungen buchen` },
      409,
    );
  }

  // Cascade löscht Buchungen, Ausgleiche und wiederkehrende Regeln des Mitglieds
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(targetId).run();

  return c.json({ ok: true });
});

/**
 * Passwort eines Mitglieds zurücksetzen (nur Ersteller): erzeugt ein
 * einmaliges Temp-Passwort und gibt es EINMALIG im Klartext zurück –
 * Cloudflare Workers können keine E-Mails versenden, daher Holt-Modell
 * über den Admin. Läufende Sitzungen bleiben gültig (JWT hängt nicht
 * am Passwort, wie bei der eigenen Passwort-Änderung auch).
 */
me.put('/api/household/members/:id/password', async (c) => {
  if (!c.get('isAdmin')) {
    return c.json({ error: 'Nur der Haushaltsersteller kann Passwörter zurücksetzen' }, 403);
  }
  // Missbrauchsschutz: max. 5 Resets pro Minute je Admin
  const limited = await enforceRateLimit(c, 'strict', `pwreset:${c.get('userId')}`);
  if (limited) return limited;

  const hid = c.get('householdId');
  const targetId = Number(c.req.param('id'));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: 'Ungültige Mitglieds-ID' }, 400);
  }

  const target = await c.env.DB
    .prepare('SELECT id, name, is_admin FROM users WHERE id = ?1 AND household_id = ?2')
    .bind(targetId, hid)
    .first<{ id: number; name: string; is_admin: number }>();
  if (!target) {
    return c.json({ error: 'Mitglied nicht gefunden' }, 404);
  }
  if (target.is_admin === 1) {
    return c.json({ error: 'Das Passwort des Haushaltserstellers kann nicht zurückgesetzt werden' }, 400);
  }

  const tempPassword = generateTempPassword();
  await c.env.DB
    .prepare('UPDATE users SET password_hash = ?1 WHERE id = ?2')
    .bind(await hashPassword(tempPassword), targetId)
    .run();

  return c.json({ ok: true, temp_password: tempPassword });
});

export default me;
