# SmartWallet produktiv setzen – Cloudflare per CLI

Diese Anleitung richtet die App komplett über die Kommandozeile auf Cloudflare ein:
**Cloudflare Workers** (App) + **D1** (Datenbank) + **Secrets** (JWT & Gemini-Key).
Alle Befehle im Projektordner ausführen. Getestet unter Windows (Git Bash / PowerShell) —
die Befehle sind identisch, nur die Weiterleitung von Skript-Ausgaben unterscheidet sich minimal.

---

## Voraussetzungen

- Cloudflare-Account (kostenlos: https://dash.cloudflare.com/sign-up)
- Node.js 18+ und npm installiert
- Gemini-API-Key (kostenlos: https://aistudio.google.com/apikey)
- Projekt-Abhängigkeiten installiert:

```bash
npm install
```

---

## Schritt 1: Bei Cloudflare anmelden

```bash
npx wrangler login
```

Es öffnet sich der Browser mit der Cloudflare-OAuth-Seite → Zugriff erlauben.
Kontrolle:

```bash
npx wrangler whoami
```

> **Fehler „not authenticated"?** Nochmal `npx wrangler login` ausführen; in Firmennetzwerken
> ggf. Proxy-Env-Variablen setzen.

---

## Schritt 2: D1-Datenbank anlegen

```bash
npx wrangler d1 create smartwallet-cd-db
```

Die Ausgabe enthält eine **`database_id`** (UUID). Diese in **`wrangler.toml`** eintragen:

```toml
[[d1_databases]]
binding = "DB"
database_name = "smartwallet-cd-db"
database_id = "HIER-DIE-ECHTE-UUID-EINTRAGEN"   # ← NUR diese Zeile ersetzen
```

> ⚠️ **Nur die `database_id` ersetzen!** Der Bindungsname `binding = "DB"` muss exakt
> so bleiben – der gesamte Code liest die Datenbank über `env.DB`. Wurde er umbenannt,
> läuft die Seite zwar, aber jeder Datenbankzugriff bricht mit 500.

---

## Schritt 3: Schema auf die produktive D1 anwenden

```bash
npm run db:init:remote
```

(Hintergrund: `wrangler d1 execute smartwallet-cd-db --remote --file=./schema.sql`.)
Wrangler fragt sicherheitshalber nochmal nach → mit **y** bestätigen.

> Dieses Script legt nur die **leeren Tabellen** an. Demo-Daten brauchst du in Produktion
> nicht — Nutzer kommen in Schritt 6, Startstand/Fixbetrag stellst du in Schritt 7 ein.

---

## Schritt 4: Secrets setzen

**JWT-Signaturschlüssel erzeugen** (zufällig, 64 Hex-Zeichen):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ausgabe kopieren und hier einfügen (Wrangler fragt interaktiv ab):

```bash
npx wrangler secret put JWT_SECRET
```

**Gemini-API-Key** (von https://aistudio.google.com/apikey):

```bash
npx wrangler secret put GEMINI_API_KEY
```

> Secrets landen verschlüsselt bei Cloudflare und sind im Code als `c.env.JWT_SECRET` /
> `c.env.GEMINI_API_KEY` verfügbar. Die `.dev.vars`-Datei ist **nur** für lokales Development.

Das Gemini-Modell steht bereits fest in `wrangler.toml` unter `[vars]`
(`GEMINI_MODEL = "gemini-3.5-flash-lite"`) und wird mit deployt.

---

## Schritt 5: Deployen

```bash
npm run deploy
```

> ⚠️ **Immer `npm run deploy` nutzen, nie direkt `npx wrangler deploy`!** Der npm-Script
> baut vorab das Tailwind-CSS (`predeploy` → `build:css`, Output: `public/assets/app.css`).
> Ohne diesen Schritt deployed die App zwar, aber alle Seiten laden ohne Stylesheet
> (`/assets/app.css` wäre nicht vorhanden).

Wrangler gibt am Ende die Produktions-URL aus, z. B.:

```
https://smartwallet-cd.<dein-subdomain>.workers.dev
```

---

## Schritt 6: Registrierung & erste Nutzer

Seit v0.3 gibt es eine öffentliche **Registrierungsseite**:

1. `https://smartwallet-cd.<dein-subdomain>.workers.dev/register` öffnen
2. **„Neuen Haushalt erstellen"** wählen: Name, E-Mail, Passwort (+ Haushaltsname) → du bist
   direkt eingeloggt und siehst deinen **Einladungscode** oben im Dashboard
3. Dein Partner/Mitbewohner ruft dieselbe Seite auf – am besten über deinen
   Einladungs-Link `https://…/register?code=DEINCODE` – wählt **„Einladungscode einlösen"**
   und registriert sich damit im selben Haushalt
4. Unten „⚙ Einstellungen": Startstand & Fixbetrag setzen (siehe Schritt 7)

**Passwort vergessen?** Per CLI zurücksetzen (Haushalts-Zuordnung bleibt erhalten):

```bash
node scripts/create-user.mjs "Anna" "anna@beispiel.de" "NeuesSicheresPasswort" --join <EINLADUNGSCODE> > reset.sql
npx wrangler d1 execute smartwallet-cd-db --remote --file=./reset.sql
rm reset.sql
```

Das Skript kann alternativ auch komplett per CLI anlegen (`--household-name "Familie X"`
statt `--join`), für den normalen Betrieb ist die Registrierungsseite aber der Weg.

> Das Demo-Seed (`POST /api/dev/seed`) ist in Produktion **abgeschaltet** (antwortet mit 404).
> Es wird ausschließlich lokal über `ENABLE_DEV_SEED=true` in `.dev.vars` aktiviert.

---

## Schritt 7: Startstand & Fixbetrag setzen

1. `https://smartwallet-cd.<dein-subdomain>.workers.dev` öffnen → mit einem der neuen Nutzer einloggen
2. Unten **„⚙ Einstellungen (Startstand & Fixbetrag)"** aufklappen:
   - **Startstand Gemeinschaftskonto** = aktueller Kontostand eures Gemeinschaftskontos
   - **Fixbetrag pro Person/Monat** = euer monatlicher Betrag x
3. **Speichern** — die Werte liegen in der D1-Tabelle `settings` und gelten für beide Nutzer

Ab jetzt erscheint im Dashboard der Button „💰 Beitrag buchen (x €)" (einmal pro Monat
pro Person, danach gesperrt) und die Schulden-Karte rechnet auf Basis eurer Vorschüsse.

---

## Schritt 8: Verifikation

```bash
# DB erreichbar?
curl https://smartwallet-cd.<dein-subdomain>.workers.dev/api/health
# → {"status":"ok","db":"connected"}

# Login funktioniert? (Cookie-Jar lokal speichern)
curl -c cookies.txt -X POST https://smartwallet-cd.<dein-subdomain>.workers.dev/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"anna@beispiel.de","password":"EinLangesSicheresPasswort"}'

# Dashboard-Export als Gegenprobe (Monat im Format YYYY-MM)
curl -b cookies.txt "https://smartwallet-cd.<dein-subdomain>.workers.dev/api/transactions?month=2026-09"
rm cookies.txt
```

Danach im Browser einloggen und „Beitrag buchen" für beide testen.

---

## Updates deployen

```bash
git pull            # bzw. deine Änderungen
npm run typecheck   # sicher sein
npm run deploy      # baut CSS vorab und deployed
```

- **Nur Code-Änderungen**: `wrangler deploy` reicht — Daten und Secrets bleiben unberührt.
- **Schema-Änderungen** (neue Spalten/Tabellen): SQL-Datei anlegen und
  `npx wrangler d1 execute smartwallet-cd-db --remote --file=./datei.sql` ausführen.
  `npm run db:reset` ist bewusst **nur lokal** (`--local`) und löscht keine Produktionsdaten.
- **Upgrade auf v0.3 (Haushalte)**: wenn deine D1 noch vor der Haushalts-Erweiterung eingerichtet
  wurde, einmal `npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/002_households.sql`
  ausführen — legt Haushalte-Tabellen an und hängt bestehende Nutzer in einen Standard-Haushalt.
- **Upgrade auf v0.4 (eigener Monatsbeitrag)**: einmal
  `npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/003_monthly_contribution.sql`
  ausführen — ergibt die Spalte `users.monthly_contribution` und übernimmt den bisherigen
  haushaltsweiten Fixbetrag (`joint_contribution`) einmalig auf alle Mitglieder. Der Beitrag wird
  danach von jedem Mitglied selbst unter „Einstellungen" gesetzt.
- **Upgrade auf v0.5 (wiederkehrende Zahlungen)**: einmal
  `npx wrangler d1 execute smartwallet-cd-db --remote --file=./migrations/004_recurring.sql`
  ausführen — ergibt die Tabellen `recurring_rules`/`recurring_skips` sowie die Spalte
  `transactions.recurring_id` (inkl. Dedupe-Index). Danach `npm run deploy` – der Cron-Trigger
  (`[triggers]` in `wrangler.toml`) wird mit dem Deploy automatisch registriert.

---

## Optional: Eigene Domain

Wenn die App unter `smartwallet-cd.beispiel.de` statt `*.workers.dev` laufen soll
(du brauchst eine bei Cloudflare gehostete Zone/Domain):

```toml
# wrangler.toml ergänzen
routes = [
  { pattern = "smartwallet-cd.beispiel.de", custom_domain = true }
]
```

Danach `npx wrangler deploy` — das DNS-Zertifikat legt Cloudflare automatisch an.

---

## Kosten / Limits

Beides läuft im **Free-Tier** für ein Zweier-Haushaltsbuch problemlos:
Workers (100.000 Anfragen/Tag frei) und D1 (5 GB Speicher, großzügiges Tageskontingent an
Zeilen-Leseoperationen). Einziger laufender Kostenpunkt kann der Gemini-Key sein — der
**kostenlose Tier** von Google AI Studio reicht für einige Dutzend Magic-Eingaben pro Tag;
aktuelle Limits siehe https://ai.google.dev/gemini-api/docs/rate-limits.

---

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| 500 „Internal Server Error" bei allem, `/api/health` meldet „Cannot read properties of undefined (reading 'prepare')" | **D1-Binding fehlt auf dem deployed Worker** – in `wrangler.toml` muss `binding = "DB"` exakt so heißen (nur die `database_id` wird ersetzt, nichts umbenennen!). Danach `npx wrangler deploy` erneut. Debug-Hilfe: `npx wrangler tail` zeigt die Ausnahme live. |
| Registrierung schlug früher ab (vor v0.3-Fix) und es gibt leere Haushalte | Aufräumen: `npx wrangler d1 execute smartwallet-cd-db --remote --command "DELETE FROM households WHERE id NOT IN (SELECT DISTINCT household_id FROM users)" -y` |
| `wrangler d1 create` meckert über Namen | D1-Name muss global bei Cloudflare eindeutig sein → anderen Namen wählen und in `wrangler.toml` (`database_name`) + Scripts anpassen |
| Dashboard: „db: unavailable" mit anderem Fehler | `database_id` in `wrangler.toml` falsch/Platzhalter, oder Schema nicht angewendet (Schritt 3) |
| Magic Input: 503 „GEMINI_API_KEY ist nicht konfiguriert" | Schritt 4 übersprungen → `npx wrangler secret put GEMINI_API_KEY` |
| Magic Input: 502 „Gemini-Aufruf fehlgeschlagen" | Ungültiger/abgelaufener API-Key oder Modell-ID — Modell steht in `wrangler.toml` (`GEMINI_MODEL`) |
| Login immer „E-Mail oder Passwort ist falsch" | Nutzer existiert nicht in der **remote** D1 → Schritt 6 prüfen (`wrangler d1 execute smartwallet-cd-db --remote --command "SELECT id, email FROM users"`) |
| 404 beim Aufruf von `/api/dev/seed` | Gewollt: Seed ist nur lokal mit `ENABLE_DEV_SEED=true` aktiv |
| Nach Passwort-Reset noch eingeloggt | Altes JWT ist bis zu 7 Tage gültig → im Dashboard „Abmelden" klicken, neu einloggen |
| `wrangler`-Befehl nicht gefunden | Im Projektordner arbeiten oder `npx wrangler ...` verwenden (so steht es überall in dieser Anleitung) |

---

## Sicherheits-Checkliste

- [x] Passwörter nur als PBKDF2-Hash in der D1 (100k Iterationen, pro Nutzer eigenes Salt)
- [x] JWT in **HTTP-only, SameSite=Lax**-Cookie; auf HTTPS automatisch `Secure`
- [x] Alle Daten-Endpoints hinter JWT-Prüfung; SQL ausschließlich mit gebundenen Parametern
- [x] Seed-Endpoint in Produktion deaktiviert (404)
- [x] Registrierung mit Honeypot-Feld gegen simple Bots; Haushalte nur per Einladungscode joinbar
- [ ] **JWT_SECRET stark und geheim** (Schritt 4 generieren lassen, nie committen — `.gitignore` deckt `.dev.vars`)
- [ ] Öffentliche Registrierung = theoretisch Massen-Registrierungen möglich. Reagiert das Projekt
      auf > 50 Haushalte: Cloudflare Turnstile (kostenlos) vor das Formular setzen oder
      Zero-Trust-Access-Policy prüfen
- [ ] workers.dev-URL ist öffentlich erreichbar: Wer die URL kennt, kann den Login-Screen sehen;
      ohne gültige Zugangsdaten gibt es aber keine Daten. Wer absolut sicher gehen will, setzt
      zusätzlich eine Cloudflare Access-Policy (Zero Trust → Access) vor die Domain.
