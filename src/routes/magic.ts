import { Hono } from 'hono';
import type { Env, TransactionAccount } from '../types';
import { requireAuth } from '../lib/auth';
import { extractTransaction } from '../lib/gemini';
import { validateTransactionInput } from '../lib/validate';

const magic = new Hono<Env>();

magic.use('/api/magic-entry', requireAuth);

magic.post('/api/magic-entry', async (c) => {
  const body = await c.req.json<{ text?: unknown; paid_from?: unknown }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length < 3 || text.length > 500) {
    return c.json({ error: 'text muss zwischen 3 und 500 Zeichen lang sein' }, 400);
  }

  // Optionaler UI-Override: 'joint'/'private' erzwingt das Konto, sonst entscheidet die KI
  const override =
    body?.paid_from === 'joint' || body?.paid_from === 'private'
      ? (body.paid_from as TransactionAccount)
      : undefined;

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('your-')) {
    return c.json({ error: 'GEMINI_API_KEY ist nicht konfiguriert (siehe .dev.vars)' }, 503);
  }

  let extracted;
  try {
    extracted = await extractTransaction(text, apiKey, c.env.GEMINI_MODEL, c.env.GEMINI_API_BASE);
  } catch (e) {
    return c.json({ error: 'Gemini-Aufruf fehlgeschlagen', detail: (e as Error).message }, 502);
  }
  if (override !== undefined) {
    extracted.paid_from = override;
  }

  const checked = validateTransactionInput(extracted);
  if ('error' in checked) {
    return c.json({ error: `KI-Antwort ungültig: ${checked.error}`, raw: extracted }, 422);
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
      source: 'magic',
    },
    201,
  );
});

export default magic;
