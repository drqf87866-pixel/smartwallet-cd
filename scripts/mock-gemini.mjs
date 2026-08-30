/**
 * Lokaler Mock für die Gemini generateContent-API (Port 8799).
 * Für Tests ohne echten API-Key: in .dev.vars
 *   GEMINI_API_KEY=test-key-mock
 *   GEMINI_API_BASE=http://127.0.0.1:8799/v1beta
 * setzen und `node scripts/mock-gemini.mjs` starten.
 *
 * Verhalten: parst den ersten Betrag aus dem Eingabetext, "wir/zusammen/
 * gemeinsam/uns" → scope "shared", sonst "personal". Der gesamte eingehende
 * Request wird nach .wrangler/mock-request.json geschrieben (Inspektion des
 * System-Prompts/responseSchema).
 */
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 8799;

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      // leeres/ungültiges Body → trotzdem antworten
    }
    const userText = body?.contents?.[0]?.parts?.[0]?.text ?? '';

    mkdirSync(join(ROOT, '.wrangler'), { recursive: true });
    writeFileSync(
      join(ROOT, '.wrangler', 'mock-request.json'),
      JSON.stringify({ url: req.url, headers: req.headers, body }, null, 2),
    );

    const amountMatch = userText.match(/(\d+(?:[.,]\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : 0;
    const shared = /wir|zusammen|gemeinsam|uns(er)?/i.test(userText);
    const privateHint = /meine karte|privat|bar\b/i.test(userText);
    const jointHint = /gemeinschaft|gemeinsame[nr]? konto/i.test(userText);
    const paidFrom = jointHint || (!privateHint && shared) ? 'joint' : 'private';
    const extracted = {
      amount,
      type: 'expense',
      scope: shared ? 'shared' : 'personal',
      paid_from: paidFrom,
      category: shared ? 'Restaurant' : 'Tanken',
      description: `Mock-Extraktion: ${userText.slice(0, 40)}`,
      date: null,
    };

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(extracted) }] } }],
      }),
    );
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Mock-Gemini läuft auf http://127.0.0.1:${PORT}`);
});
