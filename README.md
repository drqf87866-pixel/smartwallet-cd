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

## Tests

```bash
npm test
```

Die Suite läuft mit [vitest-pool-workers](https://developers.cloudflare.com/workers/testing/vitest-integration/)
direkt in der workerd-Runtime: Unit-Tests gegen die Kernlogik (`src/lib/*`:
Wiederkehrende Zahlungen, Validierung, Kategorien, Invite-Codes, Passwort-Hashing) und
Integrationstests gegen den echten Worker inklusive D1 (`test/integration/api.spec.ts`:
Registrierung, Login, Transaktionen, Passwort-Reset, Haushalts-Scoping, CSV-Export).

Für die Tests gibt es `vitest.wrangler.toml` – eine schlanke Kopie der Wrangler-Konfiguration
ohne `[assets]`, ohne Rate-Limit-Bindings (der Helper fail-t dann offen) und ohne Cron.
Das Schema wird beim Setup aus `schema.sql` in die Test-D1 gespielt; `npm run typecheck`
prüft neben `src/` auch `test/`. Ein GitHub-Actions-Workflow (`.github/workflows/ci.yml`)
führt Typecheck, CSS-Build, Tests und `wrangler deploy --dry-run` bei jedem Push/PR aus.

## Endpoints

| Route                 | Methode | Auth | Beschreibung                                                    |
|-----------------------|---------|------|-----------------------------------------------------------------|
| `/`                   | GET     | –    | Redirect zu `/dashboard` bzw. `/login`                          |
| `/login`              | GET     | –    | Login-Seite (Hono JSX)                                          |
| `/register`           | GET     | –    | Registrierungsseite (Haushalt erstellen / Code einlösen)         |
| `/dashboard`          | GET     | JWT  | Dashboard: 4 Karten, Historie, Magic Input                       |
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
| `/api/household/invite` | PUT   | JWT (Admin) | Einladungscode rotieren (alte Links ungültig)             |
| `/api/household/members/:id` | DELETE | JWT (Admin) | Mitglied entfernen (nur ohne offene Salden)          |
| `/api/household/members/:id/password` | PUT | JWT (Admin) | Passwort zurücksetzen, antwortet einmalig mit Temp-Passwort |
| `/api/me/password`    | PUT     | JWT  | Eigenes Passwort ändern (aktuelles verifizieren)                 |
| `/api/export.csv`     | GET     | JWT  | Alle Buchungen des Haushalts als CSV (Semikolon, UTF-8-BOM)      |
| `/stats`              | GET     | JWT  | Statistik: Kategorien-Donut, 6-Monats-Verlauf, Top-Ausgaben      |

## Registrierung & Haushalte

Öffentliche Seite `/register`: entweder einen **neuen Haushalt erstellen** (man wird Haushalts-Admin
und erhält den Einladungscode) oder per **Einladungscode** einem bestehenden Haushalt beitreten.
Registrierung endet direkt im eingeloggtten Dashboard. Haushalte können beliebig viele Mitglieder
haben; gemeinsame Ausgaben werden gleicheilig 1/N umgelegt, Ausgleiche laufen paarweise
(`counterpart_id`). Der Einladungscode steht im Dashboard jederzeit zum Kopieren bereit
(Link `/register?code=XYZ` legt den Code im Formular vor).

## Passwort vergessen

Es gibt keinen E-Mail-Versand (Workers ohne externen Mail-Dienst). Stattdessen setzt der
Haushalts-Ersteller in den Einstellungen per „Passwort zurücksetzen“ das Passwort eines
Mitglieds zurück und erhält ein einmaliges Temp-Passwort angezeigt (12 Zeichen, nur in der
API-Antwort, wird nicht gespeichert). Das Mitglied meldet sich damit an und ändert das
Passwort anschließend selbst. Bereits angemeldete Geräte bleiben gültig (JWT hängt nicht am
Passwort); das Passwort des Erstellers selbst kann nicht per Reset geändert werden.

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
- Verlauf lädt 50 Buchungen pro Seite; „Mehr laden“ hängt die nächsten per Fragment an
  (`/dashboard/fragments/list-more` mit Cursor). Der älteste geladene Tag wird immer
  vollständig ausgeliefert, damit Tagesgruppen nicht zerreißt

## CSV-Export

In den Einstellungen („Daten exportieren“) bzw. direkt `GET /api/export.csv`: alle Buchungen
des Haushalts als CSV-Datei – Semikolon-getrennt, Beträge mit Komma, UTF-8 mit BOM und CRLF,
damit die Datei im deutschen Excel direkt korrekt öffnet. Enthalten sind Datum, Art, Bereich,
Konto, Kategorie, Beschreibung, Betrag, Ersteller und Regel-ID (bei wiederkehrenden Buchungen).

## Rate-Limiting

Login, Registrierung, Magic-Input und Passwort-Reset sind über das native Cloudflare-Rate-
Limiting geschützt (`[[ratelimits]]` in `wrangler.toml`, Wrangler ≥ 4.36): Standard-Binding
10 Anfragen/Minute je Key (Login je IP, Magic-Input je Nutzer), Strict-Binding 5/Minute
(Registrierung je IP, Passwort-Reset je Admin). Bei Überschreitung antworten die Endpunkte
mit 429 und einer deutschen Fehlermeldung; fällt das Binding aus, failen die Endpunkte
bewusst offen statt Zugriffe zu blockieren.

## Kategorien

Standard-Kategorien liegen zentral in `src/lib/categories.ts` (Ausgaben: Lebensmittel,
Restaurant, Café, Miete, Strom, Internet, Streaming, Haushalt, Drogerie, Gesundheit,
Kleidung, Freizeit, Sport, Transport, Tanken, Urlaub, Geschenke, Bildung, Versicherung,
Sonstiges; Einnahmen: Gehalt, Nebeneinkünfte, Verkauf, Erstattung, Geschenk, Sonstiges).
Sie gelten an drei Stellen:

- **Magic Input**: Gemini bekommt die Kategorien als feste Enum im `responseSchema` und
  wählt daraus aus (Pro-Prompt-Anleitung je nach expense/income/transfer).
- **Manuelle Eingabe & Bearbeiten**: Kategorie-Felder sind geschlossene `<select>`-Dropdowns
  (serverseitig gegen die kanonische Liste validiert).

## Statistik

`/stats` (Monat navigierbar, gleicher `?month=`-Parameter wie das Dashboard): 
Ausgaben-Donut nach Kategorie, 6-Monats-Verlauf (Einnahmen/Ausgaben als Balken-SVG,
Pro-Kopf-Sicht), Top-10-Ausgaben und Monatsbilanz – alles ohne externe Chart-Library
als Inline-SVG.

## Wiederkehrende Zahlungen

Eigene Seite `/recurring` (fünfter Punkt unten in der Bottom-Navigation bzw. Button im
Desktop-Kopf): Regeln anlegen – z. B. Miete (monatlich am 1.), Streaming-Abo (monatlich)
oder Gehalt (Einnahme). Typen: `weekly` (day = Wochentag 1–7, Mo = 1), `monthly`
(day = Tag 1–31, klemmt auf den Monatsletzten) und `yearly` (month + day).

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

## Backlog (bewusst noch nicht umgesetzt)

- Dark Mode (Tailwind `dark:`-Varianten + Umschalter, Standard = Systemeinstellung)
- Sparziele (gemeinsame Ziele mit Zielbetrag, Fortschritt, Einzahlungen)
- i18n / Multi-Currency (UI und `src/lib/format.ts` sind fest auf Deutsch/EUR)
- Echtes Offline-Erlebnis (IndexedDB-Warteschlange im Service Worker statt statischer Offline-Seite)
- Push-Notification zum Monatsabschluss
- 2FA / Session-Verwaltung (JWT-Revocation, „überall abmelden“)
- Ganzzahl-Cent-Buchhaltung (Beträge liegen als REAL in D1)
- Korrekte Schuldenlogik für 3+ Mitglieder mit ungleichen Beiträgen (aktuell 1/N-Näherung)
