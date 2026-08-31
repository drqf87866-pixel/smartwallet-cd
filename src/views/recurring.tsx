import type { FC } from 'hono/jsx';
import { frequencyLabel } from '../lib/recurring';
import type { TransactionAccount, TransactionScope } from '../types';
import { Layout } from './layout';
import { BottomNav, CategoryGlobals, CategorySelect, FREQUENCY_OPTIONS, INPUT_CLASS, LABEL_CLASS, MagicSheet, UserChip } from './shared';
import { fmt, fmtDate } from '../lib/format';

/** Regel inkl. berechnetem nächsten Fälligkeitsdatum (null = inaktiv/keine mehr). */
export type RecurringRuleView = {
  id: number;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  scope: TransactionScope;
  paid_from: TransactionAccount;
  frequency: 'weekly' | 'monthly' | 'yearly';
  day: number;
  month: number | null;
  start_date: string;
  end_date: string | null;
  active: number;
  next_due: string | null;
};

const Icon: FC<{ path: string }> = ({ path }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" class="h-5 w-5" aria-hidden="true">
    <path d={path} />
  </svg>
);

/** Einmal serialisierte Regel-Map statt JSON pro Listeneintrag. */
const RecRulesCacheScript: FC<{ rules: RecurringRuleView[] }> = ({ rules }) => {
  if (rules.length === 0) return null;
  const map: Record<number, RecurringRuleView> = {};
  for (const rule of rules) map[rule.id] = rule;
  return (
    <script type="application/json" data-rec-cache dangerouslySetInnerHTML={{ __html: JSON.stringify(map) }} />
  );
};

/** Regel-Liste – eigenes Fragment (id recurring-frag). */
export const RecurringList: FC<{ rules: RecurringRuleView[] }> = ({ rules }) => {
  if (rules.length === 0) {
    return (
      <div class="flex flex-col items-center gap-2 py-8 text-center">
        <p class="text-sm text-slate-500">
          Noch keine Regeln – lege z. B. Miete, Abos oder Gehalt an und sie werden automatisch gebucht.
        </p>
        <button type="button" data-action="open-recurring" class="text-sm font-semibold text-indigo-600">
          Erste Regel anlegen
        </button>
      </div>
    );
  }
  return (
    <>
      <ul class="divide-y divide-slate-100">
        {rules.map((rule) => (
          <li class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-slate-700">
                {rule.description || rule.category}
                {rule.active ? null : (
                  <span class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">pausiert</span>
                )}
              </p>
              <p class="mt-0.5 text-xs text-slate-500">
                {frequencyLabel(rule)} · {rule.category}
                {rule.next_due ? <> · fällig am {fmtDate(rule.next_due)}</> : null}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span class={'whitespace-nowrap text-sm font-semibold tabular-nums ' + (rule.type === 'income' ? 'text-emerald-700' : 'text-red-600')}>
                {rule.type === 'income' ? '+' : '−'}
                {fmt(rule.amount)}
              </span>
              <button
                type="button"
                data-rec-menu
                data-rec-id={rule.id}
                aria-label="Regel bearbeiten oder mehr Optionen"
                class="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition active:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <RecRulesCacheScript rules={rules} />
    </>
  );
};

/** Regel-Aktionsliste (Buchen/Pausieren/Bearbeiten/Löschen) in der Daumenzone. */
const RecurringActionsOverlay: FC = () => (
  <div id="recurring-actions-overlay" class="fixed inset-0 z-50 hidden">
    <div class="absolute inset-0 bg-slate-900/40" data-close="recurring-actions-overlay"></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rec-actions-title"
      class="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 shadow-xl"
    >
      <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true"></div>
      <h2 id="rec-actions-title" class="mb-3 text-base font-semibold text-slate-800">Regel</h2>
      <div class="grid gap-3">
        <button type="button" data-rec-book class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white transition active:scale-95">
          <Icon path="M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6" />
          Jetzt buchen
        </button>
        <button type="button" data-rec-toggle class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-amber-500 text-base font-semibold text-white transition active:scale-95">
          <Icon path="M8 5v14l11-7z" />
          Pausieren / Aktivieren
        </button>
        <button type="button" data-rec-edit class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-base font-semibold text-white transition active:scale-95">
          <Icon path="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          Bearbeiten
        </button>
        <button type="button" data-rec-delete class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-base font-semibold text-red-600 transition active:scale-95">
          <Icon path="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6" />
          Löschen
        </button>
        <button type="button" data-close="recurring-actions-overlay" class="min-h-[52px] rounded-2xl border border-slate-200 bg-white text-base font-semibold text-slate-600 transition active:scale-95">
          Abbrechen
        </button>
      </div>
    </div>
  </div>
);

/** Overlay zum Bearbeiten einer Regel (nur Zukunft – bestehende Buchungen bleiben). */
const RecurringEditOverlay: FC = () => (
  <div id="recurring-edit-overlay" class="fixed inset-0 z-50 hidden">
    <div class="absolute inset-0 bg-slate-900/40" data-close="recurring-edit-overlay"></div>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recurring-edit-title"
      class="safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[42rem] sm:max-w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
    >
      <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
      <div class="mb-3 flex items-start justify-between">
        <div>
          <h2 id="recurring-edit-title" class="text-base font-semibold text-slate-800">Regel bearbeiten</h2>
          <p class="mt-1 text-xs text-slate-500">Änderungen wirken ab jetzt – bereits erzeugte Buchungen bleiben unverändert.</p>
        </div>
        <button
          type="button"
          data-close="recurring-edit-overlay"
          aria-label="Bearbeiten abbrechen"
          class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-5 w-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <form id="recurring-edit-form" class="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <label class="block">
          <span class={LABEL_CLASS}>Betrag</span>
          <input id="re-amount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="Betrag" class={INPUT_CLASS} />
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Art</span>
          <select id="re-type" class={INPUT_CLASS}>
            <option value="expense">Ausgabe</option>
            <option value="income">Einnahme</option>
          </select>
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Bereich</span>
          <select id="re-scope" class={INPUT_CLASS}>
            <option value="shared">Gemeinsam</option>
            <option value="personal">Persönlich</option>
          </select>
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Konto</span>
          <select id="re-paid-from" class={INPUT_CLASS}>
            <option value="joint">Gemeinschaftskonto</option>
            <option value="private">Privatkonto</option>
          </select>
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Kategorie</span>
          <CategorySelect id="re-category" />
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Beschreibung</span>
          <input id="re-description" type="text" maxlength={200} placeholder="Beschreibung" autocomplete="off" class={INPUT_CLASS} />
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Rhythmus</span>
          <select id="re-frequency" class={INPUT_CLASS}>
            {FREQUENCY_OPTIONS.map((opt) => (
              <option value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label class="block">
          <span class={LABEL_CLASS}>Fällig am</span>
          <input id="re-due" type="date" required autocomplete="off" class={INPUT_CLASS} />
        </label>
        <div class="flex gap-2 sm:col-span-3 lg:col-span-4">
          <button type="submit" class="btn-primary flex-1">
            Änderungen speichern
          </button>
          <button type="button" data-close="recurring-edit-overlay" class="btn-secondary">
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  </div>
);

export type RecurringViewProps = {
  userName: string;
  householdName: string;
  rules: RecurringRuleView[];
  today: string;
  memberCount: number;
};

/** Eigene Seite „Wiederkehrende Zahlungen“ (Anlegen-Sheet + Aktionsliste + Edit-Overlay). */
export const RecurringView: FC<RecurringViewProps> = ({ userName, householdName, rules, today, memberCount }) => {
  const script = `
window.__MEMBERS = ${JSON.stringify(memberCount)};
window.__swInit = window.__swInit || [];
window.__swInit.push(function () {
function recById(id) {
  return window.__REC_RULES && window.__REC_RULES[id] ? window.__REC_RULES[id] : null;
}
function recFromEl(el) {
  var id = el.getAttribute('data-rec-id');
  return id ? recById(id) : null;
}
function mergeRecCache(root) {
  var el = (root || document).querySelector('[data-rec-cache]');
  if (!el) return;
  try {
    window.__REC_RULES = Object.assign(window.__REC_RULES || {}, JSON.parse(el.textContent));
  } catch (e) {}
}
mergeRecCache(document);

function syncAllCategoryOptions() {
  ['r-', 're-'].forEach(function (prefix) {
    syncCategoryOptions(prefix, '');
  });
}

function updateRecurringPreview() {
  updatePreview('r-', window.__MEMBERS || 1);
}

document.addEventListener('change', function (e) {
  if (!e.target) return;
  if (/^(r|re)-type$/.test(e.target.id)) {
    var prefix = e.target.id.slice(0, e.target.id.indexOf('type'));
    syncCategoryOptions(prefix, '');
  }
  if (/^r-(type|scope|paid-from)$/.test(e.target.id)) updateRecurringPreview();
});

document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'r-amount') updateRecurringPreview();
});

syncAllCategoryOptions();
swApplyDefaults('r-');
updateRecurringPreview();

async function refreshRecurring() {
  if (!$('recurring-frag')) return false;
  $('recurring-frag').innerHTML = await fetchFragment('/recurring/fragments/list');
  mergeRecCache($('recurring-frag'));
  syncAllCategoryOptions();
  swApplyDefaults('r-');
  updateRecurringPreview();
  return true;
}

var REC_EDITING_ID = null;
var REC_ACTIVE = 1;
var REC_BOOK = null;

function fillRecurringForm(prefix, rule) {
  $(prefix + 'amount').value = rule.amount;
  $(prefix + 'type').value = rule.type;
  $(prefix + 'scope').value = rule.scope;
  $(prefix + 'paid-from').value = rule.paid_from;
  syncCategoryOptions(prefix, rule.category);
  $(prefix + 'description').value = rule.description;
  $(prefix + 'frequency').value = rule.frequency;
  $(prefix + 'due').value = rule.start_date;
}

document.addEventListener('click', async function (e) {
  var closer = e.target.closest('[data-close]');
  if (closer) { closeSheet(closer.getAttribute('data-close')); return; }

  var action = e.target.closest('[data-action]');
  if (action && action.getAttribute('data-action') === 'open-recurring') {
    closeSheet('recurring-actions-overlay');
    var details = $('recurring-add-wrap');
    if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth' }); }
    setTimeout(function () { if ($('r-amount')) $('r-amount').focus(); }, 200);
    return;
  }

  // Regel-Menü öffnen: Buchen/Pausieren/Bearbeiten/Löschen in der Daumenzone
  var recMenu = e.target.closest('[data-rec-menu]');
  if (recMenu) {
    var rule = recFromEl(recMenu);
    if (!rule) return;
    REC_EDITING_ID = rule.id;
    REC_ACTIVE = rule.active;
    REC_BOOK = rule.next_due;
    var bookBtn = document.querySelector('#recurring-actions-overlay [data-rec-book]');
    var toggleBtn = document.querySelector('#recurring-actions-overlay [data-rec-toggle]');
    if (bookBtn) {
      bookBtn.disabled = !rule.active || !rule.next_due;
      bookBtn.textContent = !rule.active ? 'Pausiert' : (rule.next_due ? 'Jetzt buchen' : 'Keine Fälligkeit');
    }
    if (toggleBtn) {
      toggleBtn.textContent = rule.active ? 'Pausieren' : 'Aktivieren';
    }
    var editBtn = document.querySelector('#recurring-actions-overlay [data-rec-edit]');
    if (editBtn) editBtn.setAttribute('data-rec-id', rule.id);
    var delBtn = document.querySelector('#recurring-actions-overlay [data-rec-delete]');
    if (delBtn) delBtn.setAttribute('data-rec-delete', rule.id);
    openSheet('recurring-actions-overlay');
    return;
  }

  // Sofortbuchen
  var recBook = e.target.closest('[data-rec-book]');
  if (recBook) {
    if (!REC_BOOK) return;
    if (!(await confirmSheet({
      title: 'Fälligkeit jetzt buchen?',
      message: 'Die nächste Fälligkeit (' + REC_BOOK + ') wird sofort gebucht und am Fälligkeitstag nicht erneut.',
      confirmText: 'Jetzt buchen',
    }))) return;
    var unbusyBook = busy(recBook);
    try {
      await postJson('/api/recurring/' + REC_EDITING_ID + '/book', {});
      closeSheet('recurring-actions-overlay');
      await afterMutation(refreshRecurring);
    } catch (err) {
      showToast(err.message, 'error');
      unbusyBook();
    }
    return;
  }

  var recToggle = e.target.closest('[data-rec-toggle]');
  if (recToggle) {
    var nextActive = REC_ACTIVE !== 1;
    var unbusyToggle = busy(recToggle);
    try {
      await postJson('/api/recurring/' + REC_EDITING_ID, { active: nextActive ? 1 : 0 }, 'PUT');
      closeSheet('recurring-actions-overlay');
      await afterMutation(refreshRecurring);
    } catch (err) {
      showToast(err.message, 'error');
      unbusyToggle();
    }
    return;
  }

  var recEdit = e.target.closest('[data-rec-edit]');
  if (recEdit) {
    var rule2 = recFromEl(recEdit);
    if (!rule2) return;
    REC_EDITING_ID = rule2.id;
    fillRecurringForm('re-', rule2);
    closeSheet('recurring-actions-overlay');
    openSheet('recurring-edit-overlay');
    setTimeout(function () { $('re-amount').focus(); }, 150);
    return;
  }

  var recDelete = e.target.closest('[data-rec-delete]');
  if (recDelete) {
    if (!(await confirmSheet({
      title: 'Regel löschen?',
      message: 'Die Regel wird gelöscht. Bereits erzeugte Buchungen bleiben bestehen.',
      confirmText: 'Löschen',
      danger: true,
    }))) return;
    try {
      await postJson('/api/recurring/' + recDelete.getAttribute('data-rec-delete'), {}, 'DELETE');
      closeSheet('recurring-actions-overlay');
      REC_EDITING_ID = null;
      await afterMutation(refreshRecurring);
    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }
});

document.addEventListener('submit', async function (e) {
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');

  if (form.id === 'recurring-form') {
    e.preventDefault();
    var rAmount = validAmount($('r-amount'));
    if (!rAmount) return;
    var rBody = {
      amount: rAmount,
      type: $('r-type').value,
      scope: $('r-scope').value,
      paid_from: $('r-paid-from').value,
      category: $('r-category').value,
      description: $('r-description').value,
      frequency: $('r-frequency').value,
      start_date: $('r-due').value,
    };
    var rUnbusy = busy(btn);
    try {
      await postJson('/api/recurring', rBody);
      swSaveDefaults(rBody.scope, rBody.paid_from);
      $('r-amount').value = '';
      $('r-description').value = '';
      updateRecurringPreview();
      showToast('Regel gespeichert ✓', 'ok');
      var details = $('recurring-add-wrap');
      if (details) details.open = false;
      await afterMutation(refreshRecurring);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      rUnbusy();
    }
    return;
  }

  if (form.id === 'recurring-edit-form') {
    e.preventDefault();
    if (!REC_EDITING_ID) return;
    var reAmount = validAmount($('re-amount'));
    if (!reAmount) return;
    var reBody = {
      amount: reAmount,
      type: $('re-type').value,
      scope: $('re-scope').value,
      paid_from: $('re-paid-from').value,
      category: $('re-category').value,
      description: $('re-description').value,
      frequency: $('re-frequency').value,
      start_date: $('re-due').value,
    };
    var reUnbusy = busy(btn);
    try {
      await postJson('/api/recurring/' + REC_EDITING_ID, reBody, 'PUT');
      REC_EDITING_ID = null;
      closeSheet('recurring-edit-overlay');
      showToast('Regel gespeichert ✓', 'ok');
      await afterMutation(refreshRecurring);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      reUnbusy();
    }
    return;
  }
});
});
`;

  return (
    <Layout title="Wiederkehrende Zahlungen">
      <CategoryGlobals />
      <main class="mx-auto max-w-6xl px-4 pb-44 pt-4 sm:px-8 md:pb-8">
        {/* Schlanker Kontext-Kopf (Content-First) */}
        <header class="mb-4 md:hidden">
          <h1 class="font-serif text-xl font-semibold tracking-tight text-slate-900">Dauerhaft</h1>
          <p class="text-xs text-slate-500">{householdName}</p>
        </header>

        {/* Desktop-Kopf */}
        <header class="mb-8 hidden items-center justify-between md:flex">
          <div>
            <h1 class="font-serif text-2xl font-semibold tracking-tight text-slate-900">Wiederkehrende Zahlungen</h1>
            <p class="text-sm text-slate-500">
              Regeln für „{householdName}“ werden automatisch zum Fälligkeitsdatum gebucht.
            </p>
          </div>
          <UserChip userName={userName} />
        </header>

        <section class="card mb-4">
          <div id="recurring-frag">
            <RecurringList rules={rules} />
          </div>

          <details id="recurring-add-wrap" class="mt-3 border-t border-slate-100 pt-2">
            <summary class="flex min-h-[48px] cursor-pointer select-none list-none items-center gap-2 py-2 text-sm font-semibold text-indigo-600 [&::-webkit-details-marker]:hidden">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-4 w-4" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Regel anlegen
            </summary>
            <form id="recurring-form" class="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <label class="block">
                <span class={LABEL_CLASS}>Betrag</span>
                <input id="r-amount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="Betrag" class={INPUT_CLASS} />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Art</span>
                <select id="r-type" class={INPUT_CLASS}>
                  <option value="expense" selected>Ausgabe</option>
                  <option value="income">Einnahme</option>
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Bereich</span>
                <select id="r-scope" class={INPUT_CLASS}>
                  <option value="shared" selected>Gemeinsam</option>
                  <option value="personal">Persönlich</option>
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Konto</span>
                <select id="r-paid-from" class={INPUT_CLASS}>
                  <option value="joint" selected>Gemeinschaftskonto</option>
                  <option value="private">Privatkonto</option>
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Kategorie</span>
                <CategorySelect id="r-category" />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Beschreibung</span>
                <input id="r-description" type="text" maxlength={200} placeholder="Beschreibung" autocomplete="off" class={INPUT_CLASS} />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Rhythmus</span>
                <select id="r-frequency" class={INPUT_CLASS}>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option value={opt.value} selected={opt.value === 'monthly'}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Fällig am</span>
                <input id="r-due" type="date" value={today} required autocomplete="off" class={INPUT_CLASS} />
              </label>
              <p id="r-preview" class="text-xs text-slate-500 sm:col-span-3 lg:col-span-4" aria-live="polite"></p>
              <button type="submit" class="btn-primary w-full sm:col-span-3 lg:col-span-4">
                Regel speichern
              </button>
            </form>
          </details>
        </section>

        <MagicSheet />

        <RecurringActionsOverlay />
        <RecurringEditOverlay />
      </main>

      <BottomNav page="recurring" />

      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
};
