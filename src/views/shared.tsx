import type { FC } from 'hono/jsx';
import { EXPENSE_CATEGORIES, INCOME_CATEGORY } from '../lib/categories';

/** Geteilte Klassen-Konstanten (Implementierung in src/styles/app.css, @layer components). */
export const INPUT_CLASS = 'input';
export const LABEL_CLASS = 'label-text';

/** Rhythmus-Optionen für wiederkehrende Zahlungen – geteilt zwischen /recurring und dem Dashboard. */
export const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monatlich' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'yearly', label: 'Jährlich' },
] as const;

/** Kategorie-Dropdown – Optionen werden per JS je nach Art (Ausgabe/Einnahme) befüllt. */
export const CategorySelect: FC<{ id: string }> = ({ id }) => (
  <select id={id} class={INPUT_CLASS} />
);

/** Einmalig Kategorien global setzen – vermeidet JSON.stringify auf jedem Select. */
export const CategoryGlobals: FC = () => (
  <script
    dangerouslySetInnerHTML={{
      __html: `window.__EXPENSE_CATS=${JSON.stringify(EXPENSE_CATEGORIES)};window.__INCOME_CATEGORY=${JSON.stringify(INCOME_CATEGORY)};`,
    }}
  />
);

/** Avatar-Chip oben rechts – auf allen Hauptseiten identisch und führt zu /settings. */
export const UserChip: FC<{ userName: string }> = ({ userName }) => (
  <a
    href="/settings"
    title="Einstellungen"
    aria-label="Einstellungen"
    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-base font-bold text-white shadow-sm ring-2 ring-white transition active:scale-95"
  >
    {userName.charAt(0).toUpperCase()}
  </a>
);

type BottomNavPage = 'dashboard' | 'stats' | 'recurring' | 'settings';

type BottomNavProps = {
  /** Aktive Seite – erhält aria-current="page". */
  page: BottomNavPage;
  /** Optionaler Monatskontext für Dashboard-/Statistik-Links. */
  month?: string;
};

/** Kleine Inline-SVG-Icons (Vektor statt Emoji – konsistent über Plattformen). */
const Icon: FC<{ path: string; className?: string }> = ({ path, className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" class={className ?? 'h-6 w-6'} aria-hidden="true">
    <path d={path} />
  </svg>
);

const ICONS = {
  dashboard: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  stats: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  recurring: 'M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
} as const;

const NAV_ITEMS: { page: BottomNavPage; href: (month?: string) => string; label: string }[] = [
  { page: 'dashboard', href: () => '/dashboard', label: 'Überblick' },
  { page: 'stats', href: (m) => (m ? '/stats?month=' + m : '/stats'), label: 'Statistik' },
  { page: 'recurring', href: () => '/recurring', label: 'Dauerhaft' },
  { page: 'settings', href: () => '/settings', label: 'Profil' },
];

/**
 * Mobile-First Bottom-Navigation mit zentralem FAB.
 * Layout: 2 Links links, 2 rechts, Floating-Action-Button genau in der Mitte
 * (primäre Aktion „Hinzufügen“ hervorgehoben in der Daumenzone).
 */
export const BottomNav: FC<BottomNavProps> = ({ page, month }) => (
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 backdrop-blur md:hidden"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <div class="relative grid h-16 grid-cols-5">
      {NAV_ITEMS.slice(0, 2).map((item) => (
        <NavTab key={item.page} item={item} page={page} month={month} />
      ))}
      <span aria-hidden="true" />
      {NAV_ITEMS.slice(2).map((item) => (
        <NavTab key={item.page} item={item} page={page} month={month} />
      ))}

      {/* FAB – über der Tab-Bar schwebend, fängt die Daumenzone ab */}
      <button
        type="button"
        data-action="open-magic"
        aria-label="Ausgabe hinzufügen"
        class="absolute left-1/2 top-0 flex h-14 w-14 -translate-x-1/2 -translate-y-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/40 ring-4 ring-white transition active:scale-95"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" class="h-7 w-7" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  </nav>
);

/**
 * Monats-Switcher (‹ Monat ›) für Dashboard & Statistik.
 * Kompakt-Variante ohne Label für den Mobile-Kopf (Monat steht dort als H1),
 * mit „Heute“-Sprungchip, sobald ein anderer Monat als der aktuelle offen ist.
 */
export const MonthSwitcher: FC<{
  /** Basis-Pfad für die Links, z. B. '/dashboard' oder '/stats'. */
  basePath: string;
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  compact?: boolean;
}> = ({ basePath, month, monthLabel, prevMonth, nextMonth, compact }) => {
  const isCurrent = month === new Date().toISOString().slice(0, 7);
  const arrowClass =
    'flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95';
  return (
    <nav aria-label="Monatsnavigation" class="flex shrink-0 items-center gap-1.5">
      {!isCurrent ? (
        <a
          href={basePath}
          title="Zum aktuellen Monat"
          class="flex h-9 items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-100 active:scale-95"
        >
          Heute
        </a>
      ) : null}
      <a href={basePath + '?month=' + prevMonth} aria-label="Voriger Monat" class={arrowClass}>
        <Icon path="m15 18-6-6 6-6" className="h-4 w-4" />
      </a>
      {compact ? null : (
        <span class="min-w-[8rem] text-center text-sm font-semibold tabular-nums text-slate-800">{monthLabel}</span>
      )}
      <a href={basePath + '?month=' + nextMonth} aria-label="Nächster Monat" class={arrowClass}>
        <Icon path="m9 18 6-6-6-6" className="h-4 w-4" />
      </a>
    </nav>
  );
};

const NavTab: FC<{ item: (typeof NAV_ITEMS)[number]; page: BottomNavPage; month?: string }> = ({ item, page, month }) => {
  const active = item.page === page;
  const href = item.page === 'dashboard' ? '/dashboard' : item.href(month);
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      class={
        'flex min-h-[56px] flex-col items-center justify-center gap-1 pt-1 text-[10px] font-medium transition ' +
        (active ? 'text-indigo-600' : 'text-slate-500')
      }
    >
      <Icon path={ICONS[item.page]} />
      {item.label}
    </a>
  );
};

/* ------------------------------------------------------------------ */
/* Magic Input – unten fixiertes Eingabe-Sheet (< 768 px),             */
/* auf Desktop normale Card im Seitenfluss                             */
/* ------------------------------------------------------------------ */

const PILL_ACTIVE = 'rounded-full px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white';
const PILL_IDLE = 'rounded-full px-3.5 py-2 text-sm font-medium bg-slate-100 text-slate-600';

const magicSheetCss = `
@media (max-width: 767px) {
  #magic-section {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    margin: 0;
    transform: translateY(110%);
    transition: transform 0.22s ease-out;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 -8px 30px rgba(15, 23, 42, 0.25);
  }
  body.magic-open #magic-section {
    transform: translateY(0);
  }
}
`;

/* app.js wird mit defer geladen; die Handler laufen erst bei Events. */
const magicScript = `
(function () {
var MAGIC_PAID_FROM = 'auto';
var PILL_ACTIVE = ${JSON.stringify(PILL_ACTIVE)};
var PILL_IDLE = ${JSON.stringify(PILL_IDLE)};

function openMagic() {
  document.body.classList.add('magic-open');
  $('magic-backdrop').classList.remove('hidden');
  var manualBtn = document.querySelector('[data-open-manual]');
  if (manualBtn) manualBtn.hidden = !($('manual-form') || $('recurring-form'));
  setTimeout(function () { $('magic-text').focus(); }, 150);
}
function closeMagic() {
  document.body.classList.remove('magic-open');
  $('magic-backdrop').classList.add('hidden');
}

document.addEventListener('click', function (e) {
  var pill = e.target.closest('[data-paid-from]');
  if (pill) {
    MAGIC_PAID_FROM = pill.getAttribute('data-paid-from');
    document.querySelectorAll('[data-paid-from]').forEach(function (p) {
      var active = p === pill;
      p.className = active ? PILL_ACTIVE : PILL_IDLE;
    });
    return;
  }

  var action = e.target.closest('[data-action]');
  if (action) {
    var name = action.getAttribute('data-action');
    if (name === 'open-magic') { openMagic(); return; }
    if (name === 'close-magic') { closeMagic(); return; }
  }

  var manual = e.target.closest('[data-open-manual]');
  if (manual) {
    closeMagic();
    var targetForm = $('manual-form') || $('recurring-form');
    if (targetForm) {
      var details = targetForm.closest('details');
      if (details) details.open = true;
      targetForm.scrollIntoView({ behavior: 'smooth' });
      var firstInput = targetForm.querySelector('input');
      setTimeout(function () { if (firstInput) firstInput.focus(); }, 200);
    }
    return;
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeMagic();
});

document.addEventListener('submit', async function (e) {
  if (e.target.id !== 'magic-form') return;
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var input = $('magic-text');
  var text = input.value.trim();
  if (!text) return;
  var unbusy = busy(btn, 'Wird erfasst …');
  try {
    await postJson('/api/magic-entry', { text: text, paid_from: MAGIC_PAID_FROM });
    input.value = '';
    closeMagic();
    if (window.__afterMutation) await window.__afterMutation();
    else window.location.reload();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    unbusy();
  }
});
})();
`;

/**
 * Magic-Input-Sheet – task-zentrierter Add-Flow.
 * 1. Freitext in die Daumenzone tippen (KI erkennt Betrag/Kategorie/Wer).
 * 2. Optional „Wer hat bezahlt“ per Chips festlegen.
 * 3. Großer primärer Button unten (Thumb-Zone), nicht im Kopfbereich.
 */
export const MagicSheet: FC = () => (
  <>
    <div id="magic-backdrop" data-action="close-magic" class="fixed inset-0 z-40 hidden bg-slate-900/40 md:hidden"></div>

    <section id="magic-section" class="safe-bottom card mb-4 rounded-t-2xl md:rounded-2xl">
      <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 md:hidden" aria-hidden="true"></div>

      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold text-slate-800">Ausgabe erfassen</h2>
          <p class="mt-0.5 text-xs text-slate-500">In einem Satz beschreiben – Betrag, Kategorie und Person erkennt die KI.</p>
        </div>
        <button
          type="button"
          data-action="close-magic"
          aria-label="Schließen"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-5 w-5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <form id="magic-form" class="flex flex-col gap-3">
        <input
          id="magic-text"
          type="text"
          maxlength={500}
          autocomplete="off"
          placeholder="z. B. „45 € getankt“ oder „Essen für 60 €“"
          aria-label="Ausgabe in natürlicher Sprache beschreiben"
          class={'text-base ' + INPUT_CLASS}
        />
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-slate-500">Wer hat bezahlt?</span>
          <button type="button" data-paid-from="auto" class={PILL_ACTIVE}>KI erkennen</button>
          <button type="button" data-paid-from="joint" class={PILL_IDLE}>Gemeinschaftskarte</button>
          <button type="button" data-paid-from="private" class={PILL_IDLE}>Privat / Bar</button>
        </div>
        <button id="magic-btn" type="submit" class="btn-primary w-full py-3.5 text-base">
          Hinzufügen
        </button>
        <button type="button" data-open-manual hidden class="mx-auto -mt-1 text-sm font-medium text-indigo-600 hover:underline">
          Manuell erfassen (mit Datum & Kategorie)
        </button>
      </form>
    </section>

    <style dangerouslySetInnerHTML={{ __html: magicSheetCss }} />
    <script dangerouslySetInnerHTML={{ __html: magicScript }} />
  </>
);
