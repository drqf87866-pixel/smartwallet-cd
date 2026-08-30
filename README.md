# SmartWallet

Einnahmen-Ausgaben-Dashboard für Paare – läuft komplett in einem Cloudflare Worker
(Hono für API + UI, D1 als Datenbank, Gemini für den „Magic Input").

> **Produktiv setzen?** Siehe [DEPLOY.md](./DEPLOY.md) – Schritt-für-Schritt-CLI-Anleitung
> für D1, Secrets, Deploy und erste Nutzerkonten.

## Setup

```bash
npm install

# D1 lokal anlegen und Schema anwenden
npx wrangler d1 create smartwallet-cd-db   # nur für Deploy nötig; database_id in wrangler.toml eintragen
npm run db:init

# Dev-Server starten (http://localhost:8787)
npm run dev
```

`npm run dev` und `npm run deploy` bauen das Tailwind-CSS automatisch vorab
(`npm run build:css`, Output: `public/assets/app.css`). Das precompilierte CSS
wird über das `[assets]`-Binding aus `public/` ausgeliefert – der Service
Worker cache-t diese Assets offline. Nach Änderungen an Klassen in `src/views/*`
 CSS neu bauen (passiert bei `npm run dev` nur beim Start).

`npm run db:reset` löscht die lokale D1 komplett und legt das Schema neu an
(Transfers/Settings-Modell ab v0.2 – bei Upgrade von v0.1 lokal nötig).

## Seeden

Legt zwei Demo-Nutzer (Passwort je `demo1234`) und 8 Beispiel-Transaktionen an.
Der Seed ist idempotent: existierende Nutzer werden übersprungen, Transaktionen
nur eingefügt, wenn die Tabelle leer ist.

```bash
curl -X POST http://localhost:8787/api/dev/seed
```

| Nutzer | E-Mail               | Passwort   |
|--------|----------------------|------------|
| Anna   | anna@smartwallet.app | `demo1234` |
| Ben    | ben@smartwallet.app  | `demo1234` |

## Endpoints

| Route                 | Methode | Auth | Beschreibung                                                    |
|-----------------------|---------|------|-----------------------------------------------------------------|
| `/`                   | GET     | –    | Redirect zu `/dashboard` bzw. `/login`                          |
| `/login`              | GET     | –    | Login-Seite (Hono JSX)                                          |
| `/register`           | GET     | –    | Registrierungsseite (Haushalt erstellen / Code einlösen)         |
| `/dashboard`          | GET     | JWT  | Dashboard: 4 Karten, Historie, Magic Input, Einstellungen       |
| `/api/health`         | GET     | –    | D1-Konnektivitätscheck                                          |
| `/api/dev/seed`       | POST    | –    | Demo-Nutzer + Beispiel-Transaktionen + Settings anlegen (nur lokal, `ENABLE_DEV_SEED`) |
| `/api/login`          | POST    | –    | Login, setzt JWT als HTTP-only-Cookie (`sw_token`)               |
| `/api/register`       | POST    | –    | Registrierung (Haushalt erstellen oder per Code beitreten), Auto-Login |
| `/api/logout`         | POST    | –    | Cookie löschen                                                   |
| `/api/transactions`   | GET     | JWT  | Historie (JOIN mit Creator-Name), optional `?month=YYYY-MM`      |
| `/api/transactions`   | POST    | JWT  | Transaktion manuell anlegen (inkl. `paid_from`)                  |
| `/api/magic-entry`    | POST    | JWT  | Freitext → Gemini (`gemini-3.5-flash-lite`) → Transaktion        |
| `/api/settings`       | GET/PUT | PUT: JWT | Startstand & Fixbetrag des Gemeinschaftskontos              |
| `/api/contribution`   | POST    | JWT  | Monatsbeitrag aus Fixbetrag buchen (1×/Monat, sonst 409)         |
| `/api/settlements`    | POST    | JWT  | Ausgleichszahlung zwischen den Partnern (`payer: me`/`partner`)  |
| `/api/recurring`      | GET/POST| JWT  | Wiederkehrende Zahlungen: Regeln listen/anlegen                  |
| `/api/recurring/:id`  | PUT/DEL | JWT  | Regel ändern/pausieren (`{active}`) / löschen (Buchungen bleiben)|
| `/api/budgets`        | GET/PUT | PUT: JWT | Budgets je Kategorie (`month: 'default'` oder `YYYY-MM`)     |
| `/stats`              | GET     | JWT  | Statistik: Kategorien-Donut, 12-Monats-Verlauf, Top-Ausgaben     |

## Registrierung & Haushalte

Öffentliche Seite `/register`: entweder einen **neuen Haushalt erstellen** (man wird Haushalts-Admin
und erhält den Einladungscode) oder per **Einladungscode** einem bestehenden Haushalt beitreten.
Registrierung endet direkt im eingeloggtten Dashboard. Haushalte können beliebig viele Mitglieder
haben; gemeinsame Ausgaben werden gleicheilig 1/N umgelegt, Ausgleiche laufen paarweise
(`counterpart_id`). Der Einladungscode steht im Dashboard jederzeit zum Kopieren bereit
(Link `/register?code=XYZ` legt den Code im Formular vor).

## Konten-Modell

Zwei (oder mehr) Privatkonten + ein Gemeinschaftskonto pro Haushalt. Jede Transaktion trägt
`paid_from` (`private`/`joint`), besondere Typen:

- `transfer` – Monatsbeitrag: verlässt mein Privatkonto, landet im Gemeinschaftstopf
- `settlement` – Ausgleichszahlung zwischen den Partnern (Privat → Privat)

**Berechnungen:**

- **Mein privater Saldo** = private Einnahmen − private Ausgaben − meine Beiträge ± Ausgleiche
- **Gemeinschaftskonto** = Startstand (Einstellungen) + alle Beiträge − gemeinsame Ausgaben vom Konto
- **Gemeinsame Ausgaben (Monat)** = Summe aller `shared`-Ausgaben, mit Anteil „privat vorgestreckt"
- **Wer schuldet wem?** (laufend, paarweise) = halbe Differenz der privaten **Vorschüsse** (1/N
  umgelegt, N = Mitgliederzahl) **minus Ausgleichszahlungen** zwischen dem Paar – Ausgaben vom
  Gemeinschaftskonto erzeugen keine persönlichen Schulden

### Dashboard-Berechnungen

- Monat navigierbar über `?month=YYYY-MM` (Pfeile ‹ ›) – betrifft Ausgaben-Karte und Historie
- Schulden-Karte rechnet über alle Monate (wegen Ausgleichszahlungen)

## Kategorien

Standard-Kategorien liegen zentral in `src/lib/categories.ts` (Ausgaben: Lebensmittel,
Restaurant, Café, Miete, Strom, Internet, Streaming, Haushalt, Drogerie, Gesundheit,
Kleidung, Freizeit, Sport, Transport, Tanken, Urlaub, Geschenke, Bildung, Versicherung,
Sonstiges; Einnahmen: Gehalt, Nebeneinkünfte, Verkauf, Erstattung, Geschenk, Sonstiges).
Sie gelten an drei Stellen:

- **Magic Input**: Gemini bekommt die Kategorien als feste Enum im `responseSchema` und
  wählt daraus aus (Pro-Prompt-Anleitung je nach expense/income/transfer).
- **Manuelle Eingabe & Bearbeiten**: Kategorie-Felder sind Textfelder mit
  `datalist`-Dropdown (`#standard-categories`) – Vorschläge auswählen oder frei eintippen.
- **Budgets**: das Anlage-Dropdown bietet alle Ausgaben-Kategorien.

## Budgets

Im Dashboard (Sektion „🎯 Budgets") lassen sich monatliche Budgets pro Kategorie setzen.
Ein Budget mit `month = 'default'` gilt für jeden Monat (Hinweis „gilt für jeden Monat“),
ein Budget mit konkretem `YYYY-MM` überschreibt es nur für diesen Monat. Angezeigt wird
Verbrauch mit Fortschrittsbalken (grün < 80 %, amber < 100 %, rot darüber); leeres Feld
plus ✓ löscht das Budget. Gezählt werden alle Ausgaben (`type = 'expense'`) des Haushalts
im angewählten Monat.

## Statistik

`/stats` (Monat navigierbar, gleicher `?month=`-Parameter wie das Dashboard): 
Ausgaben-Donut nach Kategorie, 12-Monats-Verlauf (Einnahmen/Ausgaben als Balken-SVG),
Top-10-Ausgaben und Monatsbilanz – alles ohne externe Chart-Library als Inline-SVG.

## Wiederkehrende Zahlungen

Im Dashboard (Sektion „🔁 Wiederkehrende Zahlungen") lassen sich Regeln anlegen – z. B.
Miete (monatlich am 1.), Streaming-Abo (monatlich) oder Gehalt (Einnahme). Typen:
`weekly` (day = Wochentag 1–7, Mo = 1), `monthly` (day = Tag 1–31, klemmt auf den
Monatsletzten) und `yearly` (month + day).

**Materialization:** Fällige Occurrences werden als normale Transaktionen erzeugt –
lazy beim Dashboard-/Fragment-Load (idempotent über den Unique-Index
`transactions(recurring_id, date)`, max. 24 Monate rückwirkend) und zusätzlich per
täglichem Cron-Trigger (`[triggers]` in `wrangler.toml`, 03:00 UTC, Handler in
`src/index.ts`). Gelöschte oder verschobene Occurrences landen in `recurring_skips`
und werden nicht neu angelegt. Regeln pausieren (`active = 0`) stoppt nur künftige
Buchungen; Regel löschen lässt bereits erzeugte Transaktionen bestehen.

### Beispiele

```bash
# Login (Cookie speichern)
curl -c cookies.txt -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@smartwallet.app","password":"demo1234"}'

# Historie des aktuellen Monats
curl -b cookies.txt 'http://localhost:8787/api/transactions?month=2026-08'

# Magic Input – "wir" → scope=shared, "ich" → scope=personal
curl -b cookies.txt -X POST http://localhost:8787/api/magic-entry \
  -H 'Content-Type: application/json' \
  -d '{"text":"Wir waren für 60 Euro essen"}'

# Wiederkehrende Zahlung anlegen (Miete, monatlich am 1.)
curl -b cookies.txt -X POST http://localhost:8787/api/recurring \
  -H 'Content-Type: application/json' \
  -d '{"amount":900,"type":"expense","scope":"shared","paid_from":"joint","category":"Miete","frequency":"monthly","day":1,"start_date":"2026-09-01"}'
```

## Gemini

- Modell: `gemini-3.5-flash-lite` (konfigurierbar via `GEMINI_MODEL` in `wrangler.toml`)
- Key: kostenlos unter https://aistudio.google.com/apikey, lokal in `.dev.vars` eintragen
- Die Antwort wird per `responseMimeType: application/json` + `responseSchema` erzwungen;
  `scope` wird im System-Prompt geregelt: „wir/zusammen/gemeinsam/uns" → `shared`, sonst `personal`

## Secrets

Lokal in `.dev.vars` (`JWT_SECRET`, `GEMINI_API_KEY`),
für Deploy via `npx wrangler secret put <NAME>`.
