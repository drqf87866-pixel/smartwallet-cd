import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import { verifyPassword } from '../lib/password';
import { COOKIE_NAME, TOKEN_TTL_SECONDS } from '../lib/auth';

const auth = new Hono<Env>();

auth.post('/api/login', async (c) => {
  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) {
    return c.json({ error: 'E-Mail und Passwort sind erforderlich' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, household_id, name, email, password_hash FROM users WHERE email = ?1',
  )
    .bind(email)
    .first<{ id: number; household_id: number; name: string; email: string; password_hash: string }>();

  // Einheitliche Fehlermeldung verhindert, dass existierende E-Mails ratbar sind
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    return c.json({ error: 'E-Mail oder Passwort ist falsch' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      uid: user.id,
      hid: user.household_id,
      name: user.name,
      email: user.email,
      exp: now + TOKEN_TTL_SECONDS,
    },
    c.env.JWT_SECRET,
  );

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: TOKEN_TTL_SECONDS,
  });

  return c.json({ user: { id: user.id, name: user.name, email: user.email } });
});

auth.post('/api/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});

export default auth;
