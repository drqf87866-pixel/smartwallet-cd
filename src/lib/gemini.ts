import { EXPENSE_CATEGORIES, INCOME_CATEGORY, ALL_CATEGORIES } from './categories';

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const SYSTEM_PROMPT = `Du bist ein Assistent für das Haushaltsbuch eines Paares mit zwei Privatkonten und einem gemeinsamen Gemeinschaftskonto und wandelt umgangssprachliche deutsche Eingaben in EINE strukturierte Finanztransaktion um.

Antworte AUSSCHLIESSLICH mit einem JSON-Objekt nach dem vorgegebenen Schema – kein Markdown, keine Erklärungen.

Regeln pro Feld:
- "amount": Betrag als Zahl in Euro, Dezimaltrennzeichen ist ein Punkt (z. B. 45.99). Kein Währungssymbol. Wenn kein Betrag erkennbar ist, setze 0.
- "type": "expense" bei Ausgaben (einkaufen, tanken, essen gehen, Miete, Kino ...), "income" bei Einnahmen (Gehalt, Erstattung, Geld erhalten, etwas verkauft ...), "transfer" bei Überweisungen/Einlagen vom eigenen Privatkonto aufs Gemeinschaftskonto (z. B. "Ich überweise 200 Euro aufs Gemeinschaftskonto", "Zahle 100 € ins gemeinsame Konto ein"). Achtung: Eine Ausgabe, die MIT der Gemeinschaftskarte bezahlt wurde, bleibt "expense" – nur tatsächliche Überweisungen Geldes aufs GK sind "transfer".
- "scope": "shared", wenn die Aktivität GEMEINSAM war – Hinweiswörter sind "wir", "zusammen", "gemeinsam", "uns", "unsere", "für uns beide" (z. B. "Wir waren für 60 Euro essen"). Sonst "personal" (z. B. "Ich war für 45 Euro tanken"). Bei "transfer" immer "shared".
- "paid_from": Konto, mit dem bezahlt wurde. "joint" bei "Gemeinschaftskonto", "Gemeinschaftskarte", "gemeinsames Konto". "private" bei "meine Karte", "privat bezahlt", "bar". Wenn nicht erkennbar: bei gemeinsamen Ausgaben "joint" (die meisten laufen übers Gemeinskonto), bei persönlichen "private". Bei "transfer" immer "joint" (das Geld landet auf dem Gemeinskonto).
- "category": GENAU EINE Kategorie aus der Enum-Liste des Schemas – passe sie passend zum type an. Für Ausgaben ("expense") sind das: ${EXPENSE_CATEGORIES.join(', ')}. Für Einnahmen ("income") immer "${INCOME_CATEGORY}". Bei "transfer" immer "Überweisung". Wähle immer die passendste Kategorie, nur wenn wirklich nichts passt: "Freizeit & Sonstiges".
- "description": kurze, klare Zusammenfassung dessen, was ausgegeben/wie eingenommen wurde (max. 60 Zeichen, ohne Betrag).
- "date": Datum der Transaktion als ISO-8601-String (z. B. "2026-08-29T18:30:00Z"), wenn die Eingabe ein Datum nennt ("gestern", "am 3. August", "vorgestern" entsprechend auflösen). Sonst null.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    amount: { type: 'NUMBER' },
    type: { type: 'STRING', enum: ['income', 'expense', 'transfer'] },
    scope: { type: 'STRING', enum: ['personal', 'shared'] },
    paid_from: { type: 'STRING', enum: ['private', 'joint'] },
    category: { type: 'STRING', enum: ALL_CATEGORIES },
    description: { type: 'STRING' },
    date: { type: 'STRING', nullable: true },
  },
  required: ['amount', 'type', 'scope', 'paid_from', 'category', 'description', 'date'],
};

export type ExtractedTransaction = {
  amount?: unknown;
  type?: unknown;
  scope?: unknown;
  paid_from?: unknown;
  category?: unknown;
  description?: unknown;
  date?: unknown;
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: { message?: string };
};

/**
 * Ruft Gemini generateContent auf und parst die JSON-Antwort in ein
 * Rohobjekt; die eigentliche Validierung übernimmt validateTransactionInput.
 */
export async function extractTransaction(
  text: string,
  apiKey: string,
  model: string = DEFAULT_MODEL,
  apiBase?: string,
): Promise<ExtractedTransaction> {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.error?.message) {
    throw new Error(`Gemini-API-Fehler: ${data.error.message}`);
  }

  const answer = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!answer) {
    throw new Error('Gemini lieferte keine Textantwort');
  }

  // Defensive: manche Modelle umschließen JSON trotzdem mit Code-Fences
  const jsonText = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed: ExtractedTransaction;
  try {
    parsed = JSON.parse(jsonText) as ExtractedTransaction;
  } catch {
    throw new Error(`Antwort war kein gültiges JSON: ${answer.slice(0, 200)}`);
  }
  return parsed;
}
