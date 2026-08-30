# SmartWallet – Ist-Analyse & Feature-Roadmap

> Ergebnis einer Codebasis-Analyse vom 2026-08-30 (Read-Only-Audit von Backend, Frontend
> und Infrastruktur). Dient als Referenz für Priorisierung künftiger Arbeit – kein Code
> wurde im Rahmen dieser Analyse verändert.

## 1. Ist-Analyse & Technisches Audit

### Core Value Proposition

SmartWallet löst das **Geld-Koordinationsproblem von Paaren/Haushalten mit gemischten Konten**: Jede:r hat ein Privatkonto, gemeinsam gibt es ein Gemeinschaftskonto. Die App beantwortet drei konkrete Fragen, die sonst in Kopf, Excel oder WhatsApp verhandelt werden:
- Was haben wir diesen Monat gemeinsam ausgegeben, und wer hat wie viel privat vorgestreckt?
- Wer schuldet wem wie viel (laufend, über Ausgleichszahlungen verrechnet)?
- Wie viel ist im Gemeinschaftstopf, nach Startguthaben, Beiträgen und gemeinsamen Ausgaben?

Zusatznutzen: **Magic Input** (Freitext → Gemini → strukturierte Buchung) senkt die Erfassungshürde massiv gegenüber klassischen Formular-Apps – „Wir waren für 60 Euro essen" wird automatisch zu `shared`/`expense`/Kategorie „Restaurant".

### Feature-Mapping

**Vollständig implementiert:**
- Auth (Login/Logout/Registrierung), Mehrpersonen-Haushalte mit Einladungscode
- Transaktionen: CRUD, manuelle Eingabe, Bearbeiten/Löschen, Monatsfilter
- Magic Input (Gemini, `responseSchema`-erzwungenes JSON, wird wie normale Nutzereingabe re-validiert)
- Einstellungen: Startguthaben Gemeinschaftskonto, individueller Monatsbeitrag pro Person, Passwort ändern, Mitglieder verwalten, Invite-Code rotieren
- Monatsbeitrag buchen (1×/Monat mit 409-Schutz), Ausgleichszahlungen zwischen Partnern
- Wiederkehrende Zahlungen (weekly/monthly/yearly) inkl. Lazy-Materialisierung + täglichem Cron, `recurring_skips` für gelöschte/verschobene Buchungen
- Statistik-Seite: Kategorien-Donut, 12-Monats-Verlauf, Top-10-Ausgaben, Pro-Person-Auswertung – alles als Inline-SVG, mit sauberen Empty-State- und Division-by-Zero-Guards
- PWA-Shell: Manifest komplett (Icons, Standalone-Display), Service Worker mit durchdachter Cache-Strategie (Assets ja, `/api/*` und Auth-HTML bewusst nie gecacht)

**Nur im Ansatz vorhanden / Stub / Doku-Drift:**
- 🔴 **Budgets: Backend zu 100 % fertig (`src/routes/budgets.ts`), aber es gibt keinerlei UI dafür.** Kein View, kein Fragment, kein Script referenziert „Budget" irgendwo im Frontend – obwohl das README eine „🎯 Budgets"-Sektion mit Fortschrittsbalken beschreibt. Das ist die größte Lücke zwischen Anspruch und Realität im Projekt.
- Kategorie-UX weicht vom README ab: dokumentiert ist ein freies Textfeld mit `datalist`-Vorschlägen, tatsächlich implementiert ist ein geschlossenes `<select>` ohne Freitext-Option (`src/views/shared.tsx`, `public/assets/app.js`).
- README behauptet, Wiederkehrende Zahlungen lägen „im Dashboard" – tatsächlich eigene `/recurring`-Seite (reine Doku-Veraltung, kein funktionaler Bug).
- Kein Passwort-Reset-Flow (Login-Seite hat keinen „Passwort vergessen"-Link, Backend hat keine Route dafür) – echter Dead-End für ausgesperrte Nutzer.
- Keine E-Mail-Verifizierung bei Registrierung.
- Keine Paginierung: `GET /api/transactions` hat ein hartes `LIMIT 200` ohne Cursor/Hinweis – ältere Historie verschwindet bei aktiven Haushalten kommentarlos.
- Dev-Seed-Endpunkt (`/api/dev/seed`) legt Demo-Konten mit fest codiertem Passwort `demo1234` an und gibt es in der Response zurück – nur durch ein Env-Flag geschützt.

### Tech Stack & Datenmodell

**Architektur:** Ein einzelner Cloudflare Worker bedient alles – JSON-API, serverseitig gerenderte Hono-JSX-Seiten, statische Assets (`[assets]`-Binding), D1 (SQLite) und einen täglichen Cron-Trigger für die Materialisierung wiederkehrender Zahlungen. Sehr kompakt und für den Einsatzzweck (ein Haushalt) gut passend.

**Datenmodell:** `households`, `users`, `transactions`, `recurring_rules`, `recurring_skips`, `budgets`, `settings` – sauber normalisiert, Haushalts-Isolation wird konsequent über die JWT-getragene `household_id` in praktisch jeder Query durchgesetzt (kein gefundenes IDOR). Schwächen: kein Index auf `users.household_id`, keine zusammengesetzte Query-Unterstützung für „Haushalt + Monat" auf `transactions`, `schema.sql` und `migrations/004_recurring.sql` definieren die `recurring_id`-Fremdschlüssel-Klausel unterschiedlich (Drift).

**Einschränkungen für den Endnutzer:**
- **Performance:** Wiederkehrende-Zahlungen-Materialisierung läuft nicht nur per Cron, sondern bei *jedem* Dashboard-/Stats-/Recurring-Seitenaufruf erneut (N+1-Query-Muster pro aktiver Regel) – bei vielen Regeln unnötige Serverlast bei jedem Laden.
- **Offline-Fähigkeit:** Der Service Worker cached nur die statische App-Hülle (JS/CSS/Icons). Finanzdaten und `/api/*` werden nie gecacht – offline sieht der Nutzer nur eine statische „keine Verbindung"-Seite, keine letzten Salden, keine Möglichkeit, Buchungen offline zu erfassen. Das widerspricht der „PWA"-Erwartung an ein Finanz-Tool.
- **Datensicherheit:** Keinerlei Backup-/Restore-Strategie im Repo dokumentiert oder skriptiert – Notfall-Wiederherstellung hängt vollständig an nicht referenzierten Cloudflare-D1-Plattformfunktionen. Löschen eines Haushaltsmitglieds löscht dessen komplette Transaktionshistorie unwiderruflich per Cascade (kein Soft-Delete/Archiv) – verzerrt rückwirkend gemeinsame Auswertungen.
- **Geld-Arithmetik:** Beträge werden als SQLite `REAL` und mit JS-Floating-Point gerechnet statt als Integer-Cent – über viele Buchungen können sich Rundungsfehler in Summen aufsummieren.
- **Mehrpersonen-Haushalte:** Schema unterstützt beliebig viele Mitglieder, die Schulden-Logik (`hasOpenBalance` in `src/routes/me.ts`) ist aber eine Gleichverteilungs-Näherung, die nur für exakt 2 Personen mit gleichem Anspruch sauber aufgeht – bei 3+ Mitgliedern mit unterschiedlichen Beiträgen kann „Wer schuldet wem" von der tatsächlichen Dashboard-Berechnung abweichen.
- **Sicherheit:** Solides Passwort-Hashing (PBKDF2-SHA256, 100k Iterationen – nach heutigem OWASP-Standard eher niedrig, empfohlen wären 600k+), aber **kein Rate-Limiting irgendwo** (Login, Registrierung/Invite-Code-Raten, Magic-Entry-Kosten), **keine JWT-Widerrufsmöglichkeit** (gestohlenes Token bleibt bis zu 7 Tage gültig, auch nach Passwortänderung), und **`POST /api/settlements` prüft nicht, ob `from` der anfragende Nutzer selbst ist** – jedes Haushaltsmitglied kann eine Ausgleichszahlung im Namen eines anderen Mitglieds anlegen, ohne dessen Zustimmung.
- **Betrieb:** Kein CI/CD, keine automatisierten Tests (nur `tsc --noEmit`), Deployment ist ein rein manueller 8-Schritte-CLI-Prozess (`DEPLOY.md`) mit mehreren fehleranfälligen Handgriffen (Datenbank-ID manuell in `wrangler.toml` eintragen, Migrationen einzeln von Hand ausführen).

---

## 2. User Experience & Pain Points

1. **Toter Floating-Action-Button auf `/settings`** – der überall sichtbare „+"-Button zum schnellen Erfassen tut auf der Einstellungsseite nichts, weil dort kein `MagicSheet` gerendert wird (`src/views/settings.tsx` vs. `src/views/shared.tsx`). Für einen prominenten Daumen-Zonen-Button ein echter Reibungspunkt.
2. **Kein Ladezustand beim Dashboard-Refresh** – nach Buchungen wird der Inhalt per `innerHTML`-Swap ausgetauscht, ohne Zwischenzustand; bei langsamer Verbindung wirkt die App kurz „eingefroren".
3. **Kategorie-Dropdown ohne serverseitige Optionen und ohne Fallback** – wird per JS befüllt; scheitert das Skript (Ad-Blocker, langsames 3G, gecachtes altes `app.js`), sind sämtliche Kategoriefelder in der App leer und unbenutzbar, ohne Hinweis.
4. **Inkonsistente Bestätigungsdialoge** – Löschen von Transaktionen/Regeln, Mitglieder entfernen und „Jetzt buchen" nutzen alle den nativen, unstylischen Browser-`confirm()` statt des app-eigenen Sheet-Systems – wirkt in einer sonst durchgestylten Mobile-UI wie ein Fremdkörper.
5. **Kein Passwort-Reset** – ausgesperrte Nutzer haben keinen Weg zurück in die App.
6. **Clipboard-Fallback für Invite-Link ist keine echte Recovery** – schlägt `navigator.clipboard` fehl, wird der rohe Link 4 Sekunden lang in einem Toast angezeigt – zu kurz, um ihn zu markieren und zu kopieren.
7. **„Jetzt buchen"-Button bei pausierten Regeln** zeigt denselben Text ob aktiv oder deaktiviert – Nutzer verstehen nicht, warum der Button ausgegraut ist (`src/views/recurring.tsx`, toter Ternary-Zweig).
8. **Race Condition beim Monatsbeitrag** – Doppelklick oder zwei offene Tabs können denselben Monatsbeitrag zweimal buchen, da Prüfung und Insert nicht atomar sind und keine DB-Constraint dagegen absichert.
9. **Stille Kategorie-Mismatches** – manuelle Eingabe validiert Kategorien nicht gegen die kanonische Liste; ein Tippfehler oder Freitext außerhalb der Norm lässt Budgets und Statistik diese Buchung stillschweigend nicht mehr zuordnen.
10. **Historie bricht bei 200 Einträgen kommentarlos ab** – keine Paginierung, kein Hinweis „mehr laden".

Die User Journey bricht am härtesten an zwei Stellen ab: **Passwort vergessen** (kompletter Dead-End) und **Budgets** (Feature existiert für den Nutzer schlicht nicht, obwohl beworben/fertig gebaut).

---

## 3. User-Centric Feature Roadmap

### 🟢 Now – High Impact / Low Effort (sofortige Reibungsreduktion)

- **Feature-Name:** Budgets-UI im Dashboard
  **Nutzer-Problem:** Nutzer können Budgets nirgends einsehen oder anlegen, obwohl das Backend das komplett unterstützt (README verspricht es sogar).
  **Lösung & Nutzen:** Sektion „🎯 Budgets" mit Kategorie-Auswahl, Betragsfeld und Fortschrittsbalken (grün/amber/rot) im Dashboard ergänzen – sofortiger Mehrwert ohne Backend-Arbeit.
  **Technische Komplexität:** Niedrig – `src/views/dashboard.tsx`, ggf. neues Fragment in `src/routes/pages.tsx`, API existiert bereits (`src/routes/budgets.ts`).

- **Feature-Name:** Magic-Input auf jeder Seite verfügbar machen
  **Nutzer-Problem:** Der „+"-Button auf `/settings` reagiert nicht – Nutzer denken, die App sei kaputt.
  **Lösung & Nutzen:** `MagicSheet` konsistent überall einbinden, wo `BottomNav` erscheint, oder FAB dort ausblenden.
  **Technische Komplexität:** Niedrig – `src/views/settings.tsx`, `src/views/shared.tsx`.

- **Feature-Name:** Einheitliche Bestätigungsdialoge
  **Nutzer-Problem:** Native Browser-Popups beim Löschen wirken unpassend und brechen den App-Flow.
  **Lösung & Nutzen:** Bestehendes Sheet-System (`openSheet`/`closeSheet`) für Lösch-/Pausier-Bestätigungen wiederverwenden – konsistentere, vertrauenswürdigere Erfahrung.
  **Technische Komplexität:** Niedrig-Mittel – `src/views/dashboard.tsx`, `src/views/recurring.tsx`, `src/views/settings.tsx`, `public/assets/app.js`.

- **Feature-Name:** „Jetzt buchen"-Label-Fix & Ladezustände
  **Nutzer-Problem:** Unklares UI-Feedback (Button-Text ändert sich nicht bei Deaktivierung; kein Lade-Indikator beim Dashboard-Refresh).
  **Lösung & Nutzen:** Klareres Feedback, weniger Verwirrung, App wirkt reaktionsschneller.
  **Technische Komplexität:** Niedrig – `src/views/recurring.tsx`, `src/views/dashboard.tsx`.

- **Feature-Name:** Settlement-Autorisierung absichern
  **Nutzer-Problem:** Jedes Haushaltsmitglied kann aktuell eine Ausgleichszahlung im Namen eines Partners anlegen – Vertrauensrisiko in einer App, deren Kernzweck korrekte Schuldenverfolgung ist.
  **Lösung & Nutzen:** `from` serverseitig auf den anfragenden Nutzer beschränken (oder Bestätigung der Gegenpartei einführen) – schützt die Kernfunktion „Wer schuldet wem" vor Manipulation.
  **Technische Komplexität:** Niedrig – `src/routes/account.ts`.

- **Feature-Name:** Kategorie-Validierung serverseitig
  **Nutzer-Problem:** Buchungen mit abweichender Kategorie-Schreibweise tauchen in Budgets/Statistik nicht auf, ohne dass der Nutzer das merkt.
  **Lösung & Nutzen:** Manuelle Eingabe/API gegen die kanonische Liste validieren (wie bereits bei Magic Input via Gemini-Schema) – verlässliche Auswertungen.
  **Technische Komplexität:** Niedrig – `src/lib/validate.ts`, `src/lib/recurring.ts`, `src/routes/budgets.ts`.

### 🟡 Next – High Impact / High Effort (Kern-Workflows erweitern)

- **Feature-Name:** Passwort-Reset per E-Mail
  **Nutzer-Problem:** Ausgesperrte Nutzer haben keinen Weg zurück in ihre Finanzdaten.
  **Lösung & Nutzen:** Selbstständige Wiederherstellung des Zugangs ohne manuellen Support-Eingriff.
  **Technische Komplexität:** Mittel – neue Route(n) in `src/routes/auth.ts`, E-Mail-Versand (z. B. über einen Provider), neue View, DB-Erweiterung für Reset-Tokens.

- **Feature-Name:** Rate-Limiting & Missbrauchsschutz
  **Nutzer-Problem:** Login, Registrierung (Invite-Code-Raten) und Magic-Entry (Gemini-Kosten) sind völlig ungeschützt gegen Automatisierung.
  **Lösung & Nutzen:** Schützt Nutzerkonten vor Brute-Force und den Betreiber vor unkontrollierten API-Kosten – indirekt Nutzernutzen durch Stabilität/Sicherheit.
  **Technische Komplexität:** Mittel – Cloudflare-native Lösung (z. B. Turnstile/Rate-Limiting-Rules) plus Anpassungen in `src/routes/auth.ts`, `src/routes/register.ts`, `src/routes/magic.ts`.

- **Feature-Name:** Paginierung der Transaktionshistorie
  **Nutzer-Problem:** Nach 200 Buchungen verschwindet ältere Historie kommentarlos aus Dashboard und API.
  **Lösung & Nutzen:** Nutzer können beliebig weit in ihre Vergangenheit zurückblättern – wichtig, sobald ein Haushalt die App länger nutzt.
  **Technische Komplexität:** Mittel – `src/routes/transactions.ts` (Cursor/Offset), `src/views/dashboard.tsx` (Infinite Scroll/„Mehr laden").

- **Feature-Name:** Korrekte Schulden-Logik für 3+ Mitglieder
  **Nutzer-Problem:** Haushalte mit mehr als zwei Personen und unterschiedlichen Beiträgen bekommen potenziell falsche „Wer schuldet wem"-Werte.
  **Lösung & Nutzen:** Verlässliche Ausgleichsberechnung auch für WGs/größere Haushalte statt nur für Paare.
  **Technische Komplexität:** Hoch – Kernlogik in `src/routes/me.ts` (`hasOpenBalance`) und den Dashboard-Berechnungen in `src/routes/pages.tsx` neu konzipieren.

- **Feature-Name:** Testabdeckung & CI/CD-Pipeline
  **Nutzer-Problem:** Kein direkter Nutzer-Impact heute, aber jede Änderung riskiert stille Regressionen an einer App, die Geld verwaltet.
  **Lösung & Nutzen:** Weniger Bugs, schnellere und sicherere Weiterentwicklung – zahlt mittelfristig auf Produktqualität ein.
  **Technische Komplexität:** Hoch – Test-Setup (z. B. Vitest + Miniflare/D1-Test-Binding), GitHub Actions Workflow.

- **Feature-Name:** Integer-Cent-Geldarithmetik
  **Nutzer-Problem:** Floating-Point-Rundungsfehler können sich über viele Buchungen in Summen einschleichen.
  **Lösung & Nutzen:** Langfristig exakte Salden ohne Cent-Abweichungen – Vertrauen in die Zahlen.
  **Technische Komplexität:** Hoch – Schema-Migration (`schema.sql`, `migrations/`), alle Geld-Berechnungen in `src/lib/validate.ts`, `src/routes/*`, `src/views/*`.

### 🔵 Later – Value Add / Enhancements

- **Feature-Name:** Echtes Offline-Erlebnis
  **Nutzer-Problem:** Ohne Verbindung sieht der Nutzer nur eine leere „Offline"-Seite statt seiner letzten Salden.
  **Lösung & Nutzen:** Letzten bekannten Stand lokal zeigen, Buchungen offline als Entwurf sammeln und bei Verbindung synchronisieren.
  **Technische Komplexität:** Hoch – `public/sw.js`, neue IndexedDB-Schicht, Sync-Logik im Backend.

- **Feature-Name:** Mehrsprachigkeit & Mehrwährungsfähigkeit
  **Nutzer-Problem:** App ist fest auf Deutsch/EUR verdrahtet.
  **Lösung & Nutzen:** Öffnet die App für nicht-deutschsprachige Nutzer und andere Währungsräume.
  **Technische Komplexität:** Hoch – i18n-Layer über alle `src/views/*`, `src/lib/format.ts`, Schema-Erweiterung um Locale/Währung je Haushalt.

- **Feature-Name:** Export & Backup für Nutzer
  **Nutzer-Problem:** Kein Weg, eigene Daten zu sichern oder für Steuer/Übersicht zu exportieren.
  **Lösung & Nutzen:** CSV/PDF-Export der Historie – Vertrauen und Datenhoheit für den Nutzer.
  **Technische Komplexität:** Mittel – neue Route + View, Nutzung bestehender `src/lib/format.ts`.

- **Feature-Name:** Benachrichtigungen (Push)
  **Nutzer-Problem:** Nutzer erfahren nicht proaktiv von neuen gemeinsamen Ausgaben, Budget-Überschreitungen oder fälligen wiederkehrenden Zahlungen.
  **Lösung & Nutzen:** Höheres Engagement, schnellere Reaktion auf Budget-Überschreitungen.
  **Technische Komplexität:** Hoch – Web Push Integration, Service-Worker-Erweiterung (`public/sw.js`), neue Backend-Trigger.

- **Feature-Name:** Erweiterte Statistik (Jahresvergleich, Sparziele)
  **Nutzer-Problem:** Aktuelle Statistik zeigt nur 12 Monate rollierend, keine Jahres-/Zielperspektive.
  **Lösung & Nutzen:** Langfristige Finanzplanung statt nur Rückblick.
  **Technische Komplexität:** Mittel – `src/views/stats.tsx`, neue Aggregations-Queries.

- **Feature-Name:** Sitzungsverwaltung & 2FA
  **Nutzer-Problem:** Gestohlene Tokens bleiben bis zu 7 Tage gültig, auch nach Passwortwechsel; kein „Alle Geräte abmelden".
  **Lösung & Nutzen:** Mehr Kontrolle und Sicherheit für sicherheitsbewusste Nutzer.
  **Technische Komplexität:** Hoch – Token-Versionierung in `src/lib/auth.ts`, Schema-Erweiterung, optionale 2FA-Implementierung.
