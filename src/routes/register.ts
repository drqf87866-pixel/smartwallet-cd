import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { hashPassword } from '../lib/password';
import { COOKIE_NAME, TOKEN_TTL_SECONDS } from '../lib/auth';
import { sign } from 'hono/jwt';
import { setCookie } from 'hono/cookie';
import { generateInviteCode, normalizeInviteCode } from '../lib/invite';
import { clientIp, enforceRateLimit } from '../lib/ratelimit';

/**
 * Öffentliche Registrierung: neuen Haushalt erstellen oder per
 * Einladungscode einem bestehenden Haushalt beitreten. Danach Auto-Login.
 */
const register = new Hono<Env>();

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

register.post('/api/register', async (c) => {
  // Rate-Limit gegen Invite-Code-Raten (5 Registrierungsversuche pro Minute und IP)
  const limited = await enforceRateLimit(c, 'strict', `register:${clientIp(c)}`);
  if (limited) return limited;

  try {
    return await handleRegister(c);
  } catch (e) {
    // Für Fehlersuche mit `npx wrangler tail` sichtbar machen
    console.error('[register] failed:', e);
    return c.json({ error: 'Registrierung fehlgeschlagen – bitte später erneut versuchen' }, 500);
  }
});

async function handleRegister(c: Context<Env>) {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);

  // Honeypot: Bots füllen versteckte Felder – still wie 404 behandeln
  if (body && asString(body.website).trim() !== '') {
    return c.json({ error: 'Not Found' }, 404);
  }

  const name = asString(body?.name).trim();
  const email = asString(body?.email).trim().toLowerCase();
  const password = asString(body?.password);
  const mode = body?.mode === 'join' ? 'join' : 'create';

  if (name.length < 2 || name.length > 50) {
    return c.json({ error: 'Bitte einen Namen (2–50 Zeichen) angeben' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Bitte eine gültige E-Mail-Adresse angeben' }, 400);
  }
  if (password.length < 8) {
    return c.json({ error: 'Das Passwort muss mindestens 8 Zeichen haben' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?1')
    .bind(email)
    .first<{ id: number }>();
  if (existing) {
    return c.json({ error: 'Diese E-Mail ist bereits registriert' }, 409);
  }

  let householdId = 0;
  let householdName: string;
  let inviteCode: string | null = null;
  let isAdmin = 0;

  if (mode === 'create') {
    householdName = asString(body?.household_name).trim().slice(0, 60);
    if (householdName.length < 2) {
      return c.json({ error: 'Bitte einen Haushaltsnamen (mind. 2 Zeichen) angeben' }, 400);
    }
    isAdmin = 1;

    // Kollisionsarmen Code erzeugen und Haushalt anlegen
    inviteCode = generateInviteCode();
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await c.env.DB.prepare(
          'INSERT INTO households (name, invite_code) VALUES (?1, ?2)',
        )
          .bind(householdName, inviteCode)
          .run();
        inserted = true;
      } catch {
        inviteCode = generateInviteCode(); // UNIQUE-Kollision → neuer Code
      }
    }
    if (!inserted) {
      return c.json({ error: 'Haushalt konnte nicht erstellt werden' }, 500);
    }
    // ID zuverlässig über den eindeutigen Code nachlesen
    // (meta.last_row_id ist auf remote D1 nicht verlässlich gefüllt)
    const householdRow = await c.env.DB
      .prepare('SELECT id FROM households WHERE invite_code = ?1')
      .bind(inviteCode)
      .first<{ id: number }>();
    if (!householdRow) {
      throw new Error('Haushalt wurde angelegt, aber nicht gefunden');
    }
    householdId = householdRow.id;
  } else {
    const code = normalizeInviteCode(body?.invite_code);
    if (code.length < 4) {
      return c.json({ error: 'Bitte einen Einladungscode eingeben' }, 400);
    }
    const household = await c.env.DB.prepare(
      'SELECT id, name FROM households WHERE invite_code = ?1',
    )
      .bind(code)
      .first<{ id: number; name: string }>();
    if (!household) {
      return c.json({ error: 'Dieser Einladungscode ist unbekannt' }, 404);
    }
    householdId = household.id;
    householdName = household.name;
  }

  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(
    'INSERT INTO users (household_id, name, email, password_hash, is_admin) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(householdId, name, email, passwordHash, isAdmin)
    .run();
  // ID zuverlässig über die eindeutige E-Mail nachlesen
  const userRow = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?1')
    .bind(email)
    .first<{ id: number }>();
  if (!userRow) {
    throw new Error('Nutzer wurde angelegt, aber nicht gefunden');
  }
  const userId = userRow.id;

  // Auto-Login
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    { uid: userId, hid: householdId, name, email, exp: now + TOKEN_TTL_SECONDS },
    c.env.JWT_SECRET,
  );
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: TOKEN_TTL_SECONDS,
  });

  return c.json(
    {
      user: { id: userId, name, email },
      household: {
        id: householdId,
        name: householdName,
        ...(inviteCode ? { invite_code: inviteCode } : {}),
      },
    },
    201,
  );
}

export default register;
