import type { FC } from 'hono/jsx';
import { Layout } from './layout';
import { BottomNav, DesktopNav, MagicSheet, INPUT_CLASS, UserChip } from './shared';
import { fmt } from '../lib/format';

export type MemberInfo = { id: number; name: string; monthly_contribution: number; isAdmin: boolean };

type SettingsProps = {
  userName: string;
  userEmail: string;
  householdName: string;
  /** Interner Join-Token – wird unsichtbar als data-Attribut transportiert, nie angezeigt. */
  inviteCode: string;
  /** Aktueller Nutzer ist der Haushaltsersteller (darf Link rotieren & Mitglieder entfernen). */
  isAdmin: boolean;
  members: MemberInfo[];
  myContribution: number;
  startBalance: number;
  recurringCount: number;
};

const script = `
window.__swInit = window.__swInit || [];
window.__swInit.push(function () {
document.getElementById('logout-btn').addEventListener('click', async function () {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

document.getElementById('copy-invite').addEventListener('click', function () {
  var code = (document.getElementById('household-card').dataset.inviteCode || '').trim();
  var link = window.location.origin + '/register?code=' + code;
  navigator.clipboard.writeText(link).then(function () {
    showToast('Einladungslink kopiert', 'ok');
  }, function () {
    showToast(link, 'info');
  });
});

var rotateBtn = document.getElementById('rotate-invite');
if (rotateBtn) {
  rotateBtn.addEventListener('click', async function () {
    if (!(await confirmSheet({
      title: 'Neuen Einladungslink generieren?',
      message: 'Der bisherige Link wird dann ungültig.',
      confirmText: 'Neu generieren',
    }))) return;
    try {
      await postJson('/api/household/invite', {}, 'PUT');
      showToast('Einladungslink neu generiert – der alte Link ist ungültig', 'ok');
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

document.querySelectorAll('.reset-password').forEach(function (btn) {
  btn.addEventListener('click', async function () {
    var name = btn.dataset.name || 'dieses Mitglied';
    if (!(await confirmSheet({
      title: 'Passwort von „' + name + '“ zurücksetzen?',
      message: 'Es wird ein einmaliges Temp-Passwort erzeugt. Das bisherige Passwort ist danach ungültig.',
      confirmText: 'Zurücksetzen',
    }))) return;
    try {
      var data = await postJson('/api/household/members/' + btn.dataset.id + '/password', {}, 'PUT');
      document.getElementById('temp-password-name').textContent = name;
      document.getElementById('temp-password-value').textContent = data.temp_password;
      openSheet('temp-password-overlay');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
});

var copyTempBtn = document.getElementById('copy-temp-password');
if (copyTempBtn) {
  copyTempBtn.addEventListener('click', function () {
    var pw = document.getElementById('temp-password-value').textContent;
    navigator.clipboard.writeText(pw).then(function () {
      showToast('Temp-Passwort kopiert', 'ok');
    }, function () {
      showToast('Kopieren nicht möglich – bitte manuell notieren', 'info');
    });
  });
}

document.querySelectorAll('.remove-member').forEach(function (btn) {
  btn.addEventListener('click', async function () {
    var name = btn.dataset.name || 'dieses Mitglied';
    if (!(await confirmSheet({
      title: '„' + name + '“ entfernen?',
      message: 'Das Mitglied wird aus dem Haushalt entfernt. Dessen Buchungen werden dabei unwiderruflich mitgelöscht.',
      confirmText: 'Entfernen',
      danger: true,
    }))) return;
    try {
      await postJson('/api/household/members/' + btn.dataset.id, {}, 'DELETE');
      showToast('Mitglied entfernt', 'ok');
      window.location.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
});

document.getElementById('contribution-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var input = document.getElementById('contribution-amount');
  var amount = parseFloat(input.value.replace(',', '.'));
  if (isNaN(amount) || amount < 0) {
    markInvalid(input);
    showToast('Bitte einen gültigen Betrag eingeben', 'error');
    return;
  }
  try {
    await postJson('/api/me/contribution', { amount: amount }, 'PUT');
    showToast('Monatsbeitrag gespeichert: ' + amount.toFixed(2).replace('.', ',') + ' €', 'ok');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('settings-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var input = document.getElementById('set-start');
  var start = parseFloat(input.value.replace(',', '.'));
  if (isNaN(start) || start < 0) {
    markInvalid(input);
    showToast('Bitte einen gültigen Startstand eingeben', 'error');
    return;
  }
  try {
    await postJson('/api/settings', { joint_start_balance: start }, 'PUT');
    showToast('Startstand gespeichert', 'ok');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('password-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var next = document.getElementById('pw-new').value;
  if (next.length < 8) {
    markInvalid(document.getElementById('pw-new'));
    showToast('Das neue Passwort muss mindestens 8 Zeichen haben', 'error');
    return;
  }
  if (next !== document.getElementById('pw-confirm').value) {
    markInvalid(document.getElementById('pw-confirm'));
    showToast('Die neuen Passwörter stimmen nicht überein', 'error');
    return;
  }
  try {
    await postJson('/api/me/password', {
      current_password: document.getElementById('pw-current').value,
      new_password: next,
    }, 'PUT');
    showToast('Passwort geändert', 'ok');
    document.getElementById('password-form').reset();
  } catch (err) {
    showToast(err.message, 'error');
  }
});
});
`;

export const SettingsView: FC<SettingsProps> = ({
  userName,
  userEmail,
  householdName,
  inviteCode,
  isAdmin,
  members,
  myContribution,
  startBalance,
  recurringCount,
}) => (
  <Layout title="Einstellungen">
    <main class="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-8 md:pb-8">
      {/* Schlanker Kontext-Kopf (Content-First) */}
      <header class="mb-4 md:hidden">
        <h1 class="font-serif text-xl font-semibold tracking-tight text-slate-900">Einstellungen</h1>
        <p class="text-xs text-slate-500">{householdName}</p>
      </header>

      {/* Desktop-Kopf – gleiche Tab-Leiste wie auf Dashboard/Statistik/Wiederkehrend */}
      <header class="mb-8 hidden items-center justify-between md:flex">
        <div>
          <h1 class="font-serif text-2xl font-semibold tracking-tight text-slate-900">Einstellungen</h1>
          <p class="text-sm text-slate-500">Profil und Haushalt für „{householdName}“.</p>
        </div>
        <div class="flex items-center gap-3">
          <DesktopNav page="settings" recurringCount={recurringCount} />
          <UserChip userName={userName} />
        </div>
      </header>

      {/* Profil-Kärtchen (Avatar/Name/E-Mail/Abmelden) – auf allen Breiten sichtbar */}
      <section class="card mb-4 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-lg font-bold text-white">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-900">{userName}</h2>
            <p class="text-xs text-slate-500">{userEmail}</p>
          </div>
        </div>
        <button
          id="logout-btn"
          class="flex min-h-[44px] items-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition active:scale-95"
        >
          Abmelden
        </button>
      </section>

      <section class="card mb-4" id="household-card" data-invite-code={inviteCode}>
        <h2 class="text-sm font-medium text-slate-500">Haushalt „{householdName}“</h2>
        <ul class="mt-3 space-y-1.5 text-sm">
          {members.map((m) => (
            <li class="rounded-xl bg-slate-50 px-3 py-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-slate-700">
                  {m.name}
                  {m.name === userName ? <span class="text-slate-500"> (du)</span> : null}
                  {m.isAdmin ? (
                    <span class="ml-2 inline-block rounded-md bg-indigo-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                      Ersteller
                    </span>
                  ) : null}
                </span>
                <span class="shrink-0 text-xs tabular-nums text-slate-500">Beitrag: {fmt(m.monthly_contribution)}</span>
              </div>
              {isAdmin && !m.isAdmin ? (
                <div class="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2">
                  <button
                    type="button"
                    class="reset-password flex min-h-[32px] items-center rounded-lg border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                    data-id={m.id}
                    data-name={m.name}
                  >
                    Passwort zurücksetzen
                  </button>
                  <button
                    type="button"
                    class="remove-member flex min-h-[32px] items-center rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    data-id={m.id}
                    data-name={m.name}
                  >
                    Entfernen
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button
            id="copy-invite"
            type="button"
            class="flex min-h-[36px] items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
          >
            Einladungslink kopieren
          </button>
          {isAdmin ? (
            <button
              id="rotate-invite"
              type="button"
              class="flex min-h-[36px] items-center rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Neu generieren
            </button>
          ) : null}
        </div>
      </section>

      <section class="card mb-4">
        <h2 class="text-sm font-medium text-slate-500">Mein Monatsbeitrag</h2>
        <p class="mt-1 text-xs text-slate-500">
          Wird per Klick auf „Beitrag buchen“ vom Privatkonto aufs Gemeinschaftskonto überwiesen.
          Jedes Mitglied setzt seinen eigenen Betrag.
        </p>
        <form id="contribution-form" class="mt-3 flex items-end gap-3">
          <div class="flex-1">
            <label for="contribution-amount" class="mb-1 block text-xs text-slate-500">
              Betrag pro Monat (€)
            </label>
            <input
              id="contribution-amount"
              type="text"
              inputmode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              value={String(myContribution).replace('.', ',')}
              autocomplete="off"
              class={INPUT_CLASS}
            />
          </div>
          <button type="submit" class="btn-primary">
            Speichern
          </button>
        </form>
      </section>

      <section class="card mb-4">
        <h2 class="text-sm font-medium text-slate-500">Gemeinschaftskonto</h2>
        <form id="settings-form" class="mt-3 flex items-end gap-3">
          <div class="flex-1">
            <label for="set-start" class="mb-1 block text-xs text-slate-500">
              Startstand (€)
            </label>
            <input
              id="set-start"
              type="text"
              inputmode="decimal"
              pattern="[0-9]+([.,][0-9]{1,2})?"
              value={String(startBalance).replace('.', ',')}
              autocomplete="off"
              class={INPUT_CLASS}
            />
          </div>
          <button type="submit" class="btn-primary">
            Speichern
          </button>
        </form>
      </section>

      <section class="card mb-4">
        <h2 class="text-sm font-medium text-slate-500">Daten exportieren</h2>
        <p class="mt-1 text-xs text-slate-500">
          Alle Buchungen des Haushalts als CSV-Datei (Semikolon-getrennt, öffnet direkt in Excel).
        </p>
        <a
          id="export-csv"
          href="/api/export.csv"
          download
          class="mt-3 inline-flex min-h-[44px] items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-600 transition active:scale-95"
        >
          CSV exportieren
        </a>
      </section>

      <section class="card">
        <h2 class="text-sm font-medium text-slate-500">Passwort ändern</h2>
        <form id="password-form" class="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label for="pw-current" class="mb-1 block text-xs text-slate-500">
              Aktuelles Passwort
            </label>
            <input id="pw-current" type="password" required autocomplete="current-password" class={INPUT_CLASS} />
          </div>
          <div>
            <label for="pw-new" class="mb-1 block text-xs text-slate-500">
              Neues Passwort
            </label>
            <input id="pw-new" type="password" required minlength={8} autocomplete="new-password" class={INPUT_CLASS} />
          </div>
          <div>
            <label for="pw-confirm" class="mb-1 block text-xs text-slate-500">
              Wiederholen
            </label>
            <input id="pw-confirm" type="password" required minlength={8} autocomplete="new-password" class={INPUT_CLASS} />
          </div>
          <button type="submit" class="btn-primary sm:col-span-3">
            Passwort ändern
          </button>
        </form>
      </section>
    </main>

    {/* Temp-Passwort nach Admin-Reset – wird nur einmal angezeigt */}
    <div id="temp-password-overlay" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-slate-900/40" data-close="temp-password-overlay"></div>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="temp-password-title"
        class="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 shadow-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      >
        <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
        <h2 id="temp-password-title" class="text-base font-semibold text-slate-800">
          Temp-Passwort für <span id="temp-password-name"></span>
        </h2>
        <p class="mt-1.5 text-sm leading-relaxed text-slate-600">
          Das alte Passwort ist ungültig. Gib das Temp-Passwort dem Mitglied weiter – es wird nur
          jetzt angezeigt und sollte nach der Anmeldung unter „Passwort ändern“ ersetzt werden.
        </p>
        <p
          id="temp-password-value"
          class="mt-3 select-all rounded-xl bg-slate-100 px-4 py-3 text-center font-mono text-lg font-semibold tracking-wider text-slate-800"
        ></p>
        <div class="mt-4 grid gap-2">
          <button type="button" id="copy-temp-password" class="btn-primary w-full">
            Temp-Passwort kopieren
          </button>
          <button type="button" data-close="temp-password-overlay" class="btn-secondary w-full">
            Schließen
          </button>
        </div>
      </div>
    </div>

    <BottomNav page="settings" />
    <MagicSheet hideOnDesktop />

    <script dangerouslySetInnerHTML={{ __html: script }} />
  </Layout>
);
