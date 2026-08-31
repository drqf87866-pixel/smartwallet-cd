import type { Context } from 'hono';
import type { Env } from '../types';

/** Zwei Grenz-Ebenen, konfiguriert in wrangler.toml ([[ratelimits]]). */
export type RateLimitPolicy = 'standard' | 'strict';

/**
 * Cloudflare-Rate-Limiting über die nativen Bindings: Überschreitung →
 * 429-JSON (der Client zeigt die Meldung per Toast). Bei Binding-Ausfall
 * failen wir bewusst offen – eine gestörte Limiter-Infrastruktur darf
 * Login und Erfassung nicht komplett blockieren.
 */
export async function enforceRateLimit(
  c: Context<Env>,
  policy: RateLimitPolicy,
  key: string,
): Promise<Response | null> {
  const binding = policy === 'strict' ? c.env.RATE_LIMITER_STRICT : c.env.RATE_LIMITER;
  if (!binding) return null;
  try {
    const result = await binding.limit({ key });
    if (result.success) return null;
  } catch (err) {
    console.error('Rate limiter unavailable – failing open', err);
    return null;
  }
  return c.json({ error: 'Zu viele Anfragen – bitte kurz warten und es erneut versuchen' }, 429);
}

/**
 * Key-Basis für IP-Limits: Cloudflare liefert die echte Client-IP in
 * cf-connecting-ip; lokal (wrangler dev) fehlt sie, dann zählt alles als "local".
 */
export function clientIp(c: Context<Env>): string {
  return c.req.header('cf-connecting-ip') ?? 'local';
}
