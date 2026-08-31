import type { FC } from 'hono/jsx';
import type { TransactionAccount, TransactionScope, TransactionType } from '../types';
import { EXPENSE_CATEGORIES } from '../lib/categories';
import { Layout } from './layout';
import { BottomNav, CategoryGlobals, CategorySelect, DesktopNav, FREQUENCY_OPTIONS, INPUT_CLASS, LABEL_CLASS, MagicSheet, MonthSwitcher, UserChip } from './shared';
import { fmt, fmtDay, fmtTime } from '../lib/format';

export type DashboardTx = {
  id: number;
  created_by: string;
  amount: number;
  type: TransactionType;
  category: string;
  description: string;
  date: string;
  scope: TransactionScope;
  paid_from: TransactionAccount;
  recurring_id: number | null;
};

export type DebtRow = {
  otherId: number;
  other: string;
  kind: 'you-owe' | 'owed-to-you';
  amount: number;
};

type MemberInfo = { id: number; name: string };

/** Kopf-Karten + Aktions-Buttons – wird auch als Fragment ausgeliefert. */
export type SummaryCardsProps = {
  members: MemberInfo[];
  monthLabel: string;
  privateBalance: number;
  jointPot: { saldo: number; start: number; transfers: number };
  sharedMonth: { total: number; advanced: number };
  debts: DebtRow[];
  myContribution: number;
  contributionBooked: boolean;
};

/** Transaktionssektion (inkl. manuellem Formular) – Fragment. */
export type TxListProps = {
  monthLabel: string;
  transactions: DashboardTx[];
  today: string;
  /** Ältere Buchungen im Monat vorhanden → „Mehr laden“-Button anzeigen. */
  hasMore: boolean;
};

export type DashboardProps = SummaryCardsProps & TxListProps & {
  userName: string;
  householdName: string;
  month: string;
  prevMonth: string;
  nextMonth: string;
  /** Anzahl wiederkehrender Regeln – Label des Einstiegs-Buttons auf die /recurring-Seite. */
  recurringCount: number;
  /** SSR-Layout: nur eine Transaktions-Repräsentation rendern (Mobile oder Desktop). */
  layout?: 'mobile' | 'desktop';
};

const BADGE_STYLES = {
  joint: 'bg-indigo-50 text-indigo-600',
  advance: 'bg-amber-50 text-amber-700',
  personal: 'bg-slate-100 text-slate-500',
  transfer: 'bg-emerald-50 text-emerald-700',
  settlement: 'bg-amber-50 text-amber-700',
} as const;

function accountBadge(t: DashboardTx): { label: string; style: string } {
  if (t.type === 'transfer') {
    return t.category === 'Beitrag'
      ? { label: 'Beitrag', style: BADGE_STYLES.transfer }
      : { label: 'Überweisung', style: BADGE_STYLES.transfer };
  }
  if (t.type === 'settlement') return { label: 'Ausgleich', style: BADGE_STYLES.settlement };
  if (t.scope === 'personal') return { label: 'Privat', style: BADGE_STYLES.personal };
  if (t.paid_from === 'private') return { label: 'Vorschuss', style: BADGE_STYLES.advance };
  return { label: 'Gemeinschaft', style: BADGE_STYLES.joint };
}

/** Kleine Inline-SVG-Icons für die Zeilen-Aktionen (Vektor statt Emoji – konsistent über Plattformen). */
const Icon: FC<{ path: string; className?: string }> = ({ path, className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" class={className ?? 'h-4 w-4'} aria-hidden="true">
    <path d={path} />
  </svg>
);

const ICON_PATHS = {
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  recurring: 'M21 12a9 9 0 1 1-2.6-6.3M21 3v6h-6',
  trash: 'M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6',
} as const;

const amountColor = (t: DashboardTx) =>
  t.type === 'income' ? 'text-emerald-700' : t.type === 'expense' ? 'text-red-600' : 'text-slate-500';
const amountSign = (t: DashboardTx) =>
  t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '↗ ';
const isEditable = (t: DashboardTx) => t.type !== 'settlement' && t.category !== 'Beitrag';
/** Nur normale Ausgaben/Einnahmen, die noch keiner Regel angehören, lassen sich wiederkehrend einrichten. */
const canMakeRecurring = (t: DashboardTx) => isEditable(t) && !t.recurring_id && t.type !== 'transfer';

/** Einmal serialisierte TX-Map statt JSON pro Button – kleineres HTML. */
const TxCacheScript: FC<{ transactions: DashboardTx[] }> = ({ transactions }) => {
  if (transactions.length === 0) return null;
  const map: Record<number, DashboardTx> = {};
  for (const t of transactions) map[t.id] = t;
  return (
    <script type="application/json" data-tx-cache dangerouslySetInnerHTML={{ __html: JSON.stringify(map) }} />
  );
};

/** Schulden-Zeilen inkl. begleichen-Button – von Mobile- und Desktop-Ansicht geteilt. */
const DebtRows: FC<{ debts: DebtRow[] }> = ({ debts }) => (
  <>
    {debts.map((d) => (
      <li class="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-700">
            {d.kind === 'owed-to-you' ? `${d.other} → du` : `du → ${d.other}`}
          </p>
          <p class={'text-sm font-semibold tabular-nums ' + (d.kind === 'owed-to-you' ? 'text-emerald-700' : 'text-amber-700')}>
            {fmt(d.amount)}
          </p>
        </div>
        <button
          type="button"
          data-quick-settle
          data-amount={d.amount.toFixed(2)}
          data-from={d.kind === 'you-owe' ? 'me' : d.otherId}
          data-to={d.kind === 'you-owe' ? d.otherId : 'me'}
          class="shrink-0 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95"
        >
          Begleichen
        </button>
      </li>
    ))}
  </>
);

/* ------------------------------------------------------------------ */
/* Fragmente: SummaryCards + TxList                                    */
/* ------------------------------------------------------------------ */

export const SummaryCards: FC<SummaryCardsProps> = ({
  members,
  monthLabel,
  privateBalance,
  jointPot,
  sharedMonth,
  debts,
  myContribution,
  contributionBooked,
}) => {
  const multi = members.length >= 2;
  return (
    <>
      {/* Hero-Karte: eine klare Hauptkennzahl + kompakte Nebenwerte */}
      <section class="space-y-3 md:hidden">
        <article class="card !p-0 overflow-hidden">
          <div class="relative px-5 pb-5 pt-7">
            <span class="absolute inset-x-5 top-5 h-1 rounded-full bg-indigo-500" aria-hidden="true"></span>
            <p class="text-sm font-medium text-slate-500">Gemeinsame Ausgaben · {monthLabel}</p>
            <p class="mt-1 font-serif text-4xl font-semibold tabular-nums tracking-tight text-slate-800">{fmt(sharedMonth.total)}</p>
            <div class="mt-4 grid grid-cols-2 gap-3">
              <div class="rounded-xl bg-emerald-50 px-3 py-2.5">
                <p class="text-[11px] text-emerald-700/80">Privat-Saldo</p>
                <p class={'font-serif text-lg font-semibold tabular-nums ' + (privateBalance >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                  {fmt(privateBalance)}
                </p>
              </div>
              <div class="rounded-xl bg-indigo-50 px-3 py-2.5">
                <p class="text-[11px] text-indigo-700/80">Gemeinschaftskonto</p>
                <p class="font-serif text-lg font-semibold tabular-nums text-indigo-700">{fmt(jointPot.saldo)}</p>
              </div>
            </div>
          </div>

          <div class="border-t border-slate-100 px-5 pb-5 pt-4">
            {!multi ? (
              <p class="rounded-xl bg-slate-50 px-4 py-3 text-sm leading-snug text-slate-500">
                Du bist solo im Haushalt. Lade deinen Partner über dein Profil ein, um gemeinsam zu buchen.
              </p>
            ) : debts.length === 0 ? (
              <p class="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" class="h-5 w-5" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Alles ausgeglichen – niemand schuldet etwas.
              </p>
            ) : (
              <>
                <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Offene Positionen</p>
                <ul class="space-y-2">
                  <DebtRows debts={debts} />
                </ul>
              </>
            )}
          </div>
        </article>

        {/* Sekundär-Aktionen: unten in der Daumenzone der Karte */}
        {myContribution > 0 && !contributionBooked ? (
          <div class="grid grid-cols-2 gap-3">
            <button
              type="button"
              data-action="contribution"
              class="min-h-[52px] rounded-2xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition active:scale-95"
            >
              Beitrag buchen
              <span class="block text-xs font-normal text-emerald-100">{fmt(myContribution)}</span>
            </button>
            <button type="button" data-action="open-settle" class="min-h-[52px] rounded-full border-2 border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition active:scale-95">
              Ausgleichen
            </button>
          </div>
        ) : (
          <button type="button" data-action="open-settle" class="min-h-[52px] w-full rounded-full border-2 border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition active:scale-95">
            Ausgleichen
          </button>
        )}
      </section>

      {/* Desktop: Kachel-Grid */}
      <section class="mb-8 hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-4">
        <article class="card">
          <h2 class="text-sm font-medium text-slate-500">Mein privater Saldo</h2>
          <p class={'mt-2 font-serif text-2xl font-semibold tabular-nums sm:text-3xl ' + (privateBalance >= 0 ? 'text-emerald-700' : 'text-red-600')}>
            {fmt(privateBalance)}
          </p>
          <p class="mt-1 text-xs text-slate-500">inkl. Beiträge & Ausgleichen</p>
        </article>

        <article class="card">
          <h2 class="text-sm font-medium text-slate-500">Gemeinschaftskonto</h2>
          <p class={'mt-2 font-serif text-2xl font-semibold tabular-nums sm:text-3xl ' + (jointPot.saldo >= 0 ? 'text-indigo-600' : 'text-red-600')}>
            {fmt(jointPot.saldo)}
          </p>
          <p class="mt-1 text-xs text-slate-500">
            Startstand {fmt(jointPot.start)} · Einzahlungen {fmt(jointPot.transfers)}
          </p>
        </article>

        <article class="card">
          <h2 class="text-sm font-medium text-slate-500">Gemeinsame Ausgaben</h2>
          <p class="mt-2 font-serif text-2xl font-semibold tabular-nums text-indigo-600 sm:text-3xl">{fmt(sharedMonth.total)}</p>
          <p class="mt-1 text-xs text-slate-500">
            davon {fmt(sharedMonth.advanced)} privat vorgestreckt · {monthLabel}
          </p>
        </article>

        <article class="card">
          <h2 class="text-sm font-medium text-slate-500">Wer schuldet wem?</h2>
          {!multi ? (
            <p class="mt-2 text-xs text-slate-500">
              Du bist derzeit solo im Haushalt. Teile den Einladungslink (oben rechts unter deinem Namen → Einstellungen),
              um die gemeinsame Abrechnung zu starten.
            </p>
          ) : debts.length === 0 ? (
            <>
              <p class="mt-2 font-serif text-2xl font-semibold tabular-nums text-emerald-700 sm:text-3xl">{fmt(0)}</p>
              <p class="mt-1 text-xs text-slate-500">
                Alles ausgeglichen <span aria-hidden="true">🎉</span>
              </p>
            </>
          ) : (
            <ul class="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs">
              <DebtRows debts={debts} />
            </ul>
          )}
          <p class="mt-2 text-[10px] text-slate-500">
            laufend: private Vorschüsse 1/{members.length} umgelegt − Ausgleiche
          </p>
        </article>

        <section class="col-span-full flex flex-wrap items-center gap-3 md:col-span-2 xl:col-span-4">
          {myContribution > 0 && !contributionBooked ? (
            <button type="button" data-action="contribution" class="btn-primary bg-emerald-600 hover:bg-emerald-700">
              Beitrag buchen ({fmt(myContribution)})
            </button>
          ) : null}
          <button type="button" data-action="open-settle" class="btn-secondary">
            Ausgleichen
          </button>
        </section>
      </section>
    </>
  );
};

const TxRow: FC<{ t: DashboardTx }> = ({ t }) => {
  const badge = accountBadge(t);
  const editable = isEditable(t);
  return (
    <tr class="group border-b border-slate-100 last:border-0">
      <td class="whitespace-nowrap py-2.5 pr-3 text-slate-500">
        {fmtDay(t.date)}
        <span class="block text-xs text-slate-500">{fmtTime(t.date)}</span>
      </td>
      <td class="py-2.5 pr-3">
        <span class="font-medium text-slate-700">{t.description || t.category}</span>
        {t.type !== 'income' ? (
          <span class="ml-2 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {t.category}
          </span>
        ) : null}
        {t.recurring_id ? (
          <span
            class="ml-1 whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600"
            title="Wiederkehrende Zahlung"
          >
            <span aria-hidden="true">🔁</span>
            <span class="sr-only">Wiederkehrende Zahlung</span>
          </span>
        ) : null}
      </td>
      <td class="py-2.5 pr-3 text-slate-500">{t.created_by}</td>
      <td class="py-2.5 pr-3">
        <span class={'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ' + badge.style}>
          {badge.label}
        </span>
      </td>
      <td class={'whitespace-nowrap py-2.5 text-right font-semibold tabular-nums ' + amountColor(t)}>
        {amountSign(t)}
        {fmt(t.amount)}
      </td>
      <td class="whitespace-nowrap py-2.5 pl-3 text-right">
        {editable ? (
          /* Aktionen erst bei Hover/Fokus zeigen (Platz bleibt reserviert) – ruhigere Tabelle */
          <span class="inline-flex items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              data-edit
              data-tx-id={t.id}
              title="Bearbeiten"
              aria-label="Transaktion bearbeiten"
              class="flex h-8 w-8 items-center justify-center rounded border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
            >
              <Icon path={ICON_PATHS.edit} />
            </button>
            {canMakeRecurring(t) ? (
              <button
                type="button"
                data-make-recurring
                data-tx-id={t.id}
                title="Wiederkehrend einrichten"
                aria-label="Als wiederkehrende Zahlung einrichten"
                class="ml-1.5 flex h-8 w-8 items-center justify-center rounded border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
              >
                <Icon path={ICON_PATHS.recurring} />
              </button>
            ) : null}
            <button
              type="button"
              data-delete={t.id}
              title="Löschen"
              aria-label="Transaktion löschen"
              class="ml-1.5 flex h-8 w-8 items-center justify-center rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            >
              <Icon path={ICON_PATHS.trash} />
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
};

/** Gruppiert die Transaktionen (bereits datum-absteigend) nach Kalendertag. */
function groupByDay(txs: DashboardTx[]): { key: string; items: DashboardTx[] }[] {
  const groups: { key: string; items: DashboardTx[] }[] = [];
  for (const t of txs) {
    const key = String(t.date).slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(t);
    else groups.push({ key, items: [t] });
  }
  return groups;
}

function dayLabel(key: string, today: string): string {
  if (key === today) return 'Heute';
  const y = new Date(today + 'T12:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  if (key === y.toISOString().slice(0, 10)) return 'Gestern';
  return fmtDay(key + 'T12:00:00Z');
}

/** Mobil: nach Tagen gruppierte Karten – von Liste und „Mehr laden“-Fragment geteilt. */
const TxDayGroups: FC<{ transactions: DashboardTx[]; today: string }> = ({ transactions, today }) => (
  <>
    {groupByDay(transactions).map((g) => (
      <div key={g.key}>
        <p class="pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{dayLabel(g.key, today)}</p>
        <ul class="divide-y divide-slate-100">
          {g.items.map((t) => (
            <TxCard t={t} />
          ))}
        </ul>
      </div>
    ))}
  </>
);

/** „Mehr laden“-Button samt Wrapper – der Client ersetzt ihn beim Nachladen. */
const LoadMoreButton: FC<{ date: string; id: number }> = ({ date, id }) => (
  <div class="mt-4 flex justify-center" data-load-more-wrap>
    <button
      type="button"
      data-load-more
      data-before-date={String(date)}
      data-before-id={String(id)}
      class="flex min-h-[48px] items-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-indigo-600 shadow-sm transition active:scale-95"
    >
      Mehr laden
    </button>
  </div>
);

/** Mobile Transaktionskarte – Tippen auf „⋯“ öffnet die Aktions-Liste (Daumenzone). */
const TxCard: FC<{ t: DashboardTx }> = ({ t }) => {
  const badge = accountBadge(t);
  const editable = isEditable(t);
  return (
    <li class="flex items-center gap-3 py-3">
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium text-slate-800">{t.description || t.category}</p>
        <p class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <span class={'rounded-full px-2 py-0.5 font-medium ' + badge.style}>{badge.label}</span>
          {t.type !== 'income' ? <span class="truncate">{t.category}</span> : null}
          {t.recurring_id ? (
            <span class="rounded-full bg-violet-50 px-2 py-0.5 font-medium text-violet-600" title="Wiederkehrende Zahlung">
              🔁
            </span>
          ) : null}
        </p>
        <p class="mt-0.5 text-xs text-slate-400">
          {fmtDay(t.date)} · {fmtTime(t.date)} · {t.created_by}
        </p>
      </div>
      <span class={'whitespace-nowrap font-semibold tabular-nums ' + amountColor(t)}>
        {amountSign(t)}
        {fmt(t.amount)}
      </span>
      {editable ? (
        <button
          type="button"
          data-card-menu
          data-tx-id={t.id}
          aria-label="Transaktion bearbeiten oder löschen"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 transition active:bg-slate-100"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      ) : (
        // Platzhalter in gleicher Größe, damit der Betrag unabhängig von der
        // Bearbeitbarkeit immer an derselben Position endet (nicht fokussierbar).
        <span class="h-10 w-10 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
};

/**
 * „Mehr laden“-Fragment: nur die zusätzlichen Tagesgruppen (mobil) bzw.
 * Tabellenzeilen (Desktop) plus der nächste Button. Desktop-Zeilen stecken
 * in einer vollständigen Tabelle, damit sie beim innerHTML-Parsen nicht
 * vom Browser entfernt werden.
 */
export const TxListMore: FC<{
  transactions: DashboardTx[];
  today: string;
  layout: 'mobile' | 'desktop';
  hasMore: boolean;
}> = ({ transactions, today, layout, hasMore }) => {
  const last = transactions[transactions.length - 1];
  return (
    <>
      {layout === 'desktop' ? (
        <table>
          <tbody data-more-items>
            {transactions.map((t) => (
              <TxRow t={t} />
            ))}
          </tbody>
        </table>
      ) : (
        <div data-more-items>
          <TxDayGroups transactions={transactions} today={today} />
        </div>
      )}
      {hasMore && last ? <LoadMoreButton date={String(last.date)} id={last.id} /> : null}
      <TxCacheScript transactions={transactions} />
    </>
  );
};

/**
 * Transaktionssektion. `layout` steuert, welche Repräsentation gerendert
 * wird: 'mobile' oder 'desktop' – nur eine Variante pro Request.
 */
export const TxList: FC<TxListProps & { layout?: 'mobile' | 'desktop' }> = ({
  monthLabel,
  transactions,
  today,
  hasMore,
  layout = 'mobile',
}) => {
  return (
    <section>
      {/* Monats-Steuerung sitzt im Kopf der Seite (MonthSwitcher), nicht mehr als fixe Bar */}
      <div class="mb-1 flex items-center justify-between md:hidden">
        <h2 class="font-serif text-base font-semibold text-slate-800">Transaktionen</h2>
      </div>

      <details class="mb-4 md:hidden">
        <summary class="flex min-h-[48px] cursor-pointer select-none list-none items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-600 shadow-sm [&::-webkit-details-marker]:hidden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-4 w-4" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Eintrag manuell hinzufügen
        </summary>
        <form id="manual-form" class="mt-3 grid gap-3">
          <label class="block">
            <span class={LABEL_CLASS}>Betrag</span>
            <input id="m-amount" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required placeholder="z. B. 12,50" class={INPUT_CLASS} />
          </label>
          <label class="block">
            <span class={LABEL_CLASS}>Beschreibung</span>
            <input id="m-description" type="text" maxlength={200} placeholder="Beschreibung" autocomplete="off" class={INPUT_CLASS} />
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class={LABEL_CLASS}>Art</span>
              <select id="m-type" class={INPUT_CLASS}>
                <option value="expense" selected>Ausgabe</option>
                <option value="income">Einnahme</option>
              </select>
            </label>
            <label class="block">
              <span class={LABEL_CLASS}>Bereich</span>
              <select id="m-scope" class={INPUT_CLASS}>
                <option value="shared" selected>Gemeinsam</option>
                <option value="personal">Persönlich</option>
              </select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class={LABEL_CLASS}>Konto</span>
              <select id="m-paid-from" class={INPUT_CLASS}>
                <option value="joint" selected>Gemeinschaftskonto</option>
                <option value="private">Privatkonto</option>
              </select>
            </label>
            <label id="m-category-field" class="block">
              <span class={LABEL_CLASS}>Kategorie</span>
              <CategorySelect id="m-category" />
            </label>
          </div>
          <label class="block">
            <span class={LABEL_CLASS}>Datum</span>
            <input id="m-date" type="date" value={today} autocomplete="off" class={INPUT_CLASS} />
          </label>
          <p id="m-preview" class="text-xs text-slate-500" aria-live="polite"></p>
          <button type="submit" class="btn-primary w-full">
            Speichern
          </button>
        </form>
      </details>

      {transactions.length === 0 ? (
        <div class="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-slate-200">
          <span class="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-500" aria-hidden="true">
            <Icon path="M9 14h6M9 10h6M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" className="h-6 w-6" />
          </span>
          <div>
            <p class="text-sm font-medium text-slate-700">Noch keine Transaktionen im {monthLabel}</p>
            <p class="mt-0.5 text-xs text-slate-500">Beschreibe die erste Ausgabe in einem Satz – die KI macht den Rest.</p>
          </div>
          <button type="button" data-action="open-magic" class="btn-primary">
            Erste Ausgabe erfassen
          </button>
        </div>
      ) : (
        <>
          {/* Mobile: nach Tagen gruppierte Kartenliste */}
          {layout !== 'desktop' ? (
            <div class="md:hidden">
              <div
                class="divide-y divide-slate-100 rounded-2xl bg-white px-4 shadow-sm ring-1 ring-slate-200"
                data-tx-list-mobile
              >
                <TxDayGroups transactions={transactions} today={today} />
              </div>
            </div>
          ) : null}

          {/* Desktop: Tabelle */}
          {layout !== 'mobile' ? (
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full text-sm">
                <caption class="sr-only">Transaktionen im {monthLabel}</caption>
                <thead>
                  <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" class="py-2 pr-3 font-medium">Datum</th>
                    <th scope="col" class="py-2 pr-3 font-medium">Beschreibung</th>
                    <th scope="col" class="py-2 pr-3 font-medium">Von</th>
                    <th scope="col" class="py-2 pr-3 font-medium">Konto</th>
                    <th scope="col" class="py-2 text-right font-medium">Betrag</th>
                    <th scope="col" class="py-2 pl-3 text-right font-medium">Aktionen</th>
                  </tr>
                </thead>
                <tbody data-tx-list-desktop>
                  {transactions.map((t) => (
                    <TxRow t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasMore && transactions.length > 0 ? (
            <LoadMoreButton
              date={String(transactions[transactions.length - 1].date)}
              id={transactions[transactions.length - 1].id}
            />
          ) : null}
        </>
      )}

      <TxCacheScript transactions={transactions} />
    </section>
  );
};

/* ------------------------------------------------------------------ */
/* Client-Script: Event-Delegation + Fragment-Refresh                  */
/* ------------------------------------------------------------------ */

const script = `
window.__swInit = window.__swInit || [];
window.__swInit.push(function () {
// --- Transaktions-Lookup aus einmaliger __TX-Map statt JSON pro Button ---
function txById(id) {
  return window.__TX && window.__TX[id] ? window.__TX[id] : null;
}
function txFromEl(el) {
  var id = el.getAttribute('data-tx-id');
  return id ? txById(id) : null;
}
function mergeTxCache(root) {
  var el = (root || document).querySelector('[data-tx-cache]');
  if (!el) return;
  try {
    window.__TX = Object.assign(window.__TX || {}, JSON.parse(el.textContent));
  } catch (e) {}
}
mergeTxCache(document);

// --- Ausgleichsformular: Empfänger-Auswahl ohne den Zahlenden ---
function rebuildRecipientOptions() {
  var from = $('s-from').value;
  var to = $('s-to');
  var current = to.value;
  to.innerHTML = '';
  var options = JSON.parse(to.getAttribute('data-members'));
  options.forEach(function (m) {
    if (String(m.id) === from) return;
    var opt = document.createElement('option');
    opt.value = String(m.id) === 'me' ? 'me' : m.id;
    opt.textContent = m.name;
    to.appendChild(opt);
  });
  var stillThere = Array.prototype.some.call(to.options, function (o) { return o.value === current; });
  if (stillThere) to.value = current;
}
rebuildRecipientOptions();

// --- Transaktion bearbeiten ---
var EDITING_ID = null;
var EDITING_TIME = '';

function openEditModal(tx) {
  EDITING_ID = tx.id;
  EDITING_TIME = String(tx.date).slice(10);
  $('e-amount').value = tx.amount;
  $('e-type').value = tx.type;
  $('e-scope').value = tx.scope;
  $('e-paid-from').value = tx.paid_from;
  syncCategoryOptions('e-', tx.category);
  $('e-description').value = tx.description;
  $('e-date').value = String(tx.date).slice(0, 10);
  openSheet('edit-overlay');
  setTimeout(function () { $('e-amount').focus(); }, 150);
}

// --- Transaktion als wiederkehrend einrichten ---
var MAKE_RECURRING_TX = null;

function openMakeRecurringModal(tx) {
  MAKE_RECURRING_TX = tx;
  $('mr-summary').textContent = (tx.description || tx.category) + ' · ' + tx.amount + ' € · ab ' + String(tx.date).slice(0, 10);
  $('mr-frequency').value = 'monthly';
  $('mr-end-date').value = '';
  openSheet('make-recurring-overlay');
}

function syncAllCategoryOptions() {
  ['m-', 'e-'].forEach(function (prefix) {
    syncCategoryOptions(prefix, '');
  });
}

function updateManualPreview() {
  updatePreview('m-', window.__MEMBERS || 1);
}

document.addEventListener('change', function (e) {
  if (!e.target) return;
  if (e.target.id === 's-from') rebuildRecipientOptions();
  if (/^(m|e)-type$/.test(e.target.id)) {
    var prefix = e.target.id.slice(0, e.target.id.indexOf('type'));
    syncCategoryOptions(prefix, '');
  }
  if (/^m-(type|scope|paid-from)$/.test(e.target.id)) updateManualPreview();
});

document.addEventListener('input', function (e) {
  if (e.target && e.target.id === 'm-amount') updateManualPreview();
});

syncAllCategoryOptions();
swApplyDefaults('m-');
updateManualPreview();

async function refreshDashboard() {
  var month = window.__MONTH;
  if (!month || !$('summary-frag') || !$('tx-frag')) return false;
  var frags = [$('summary-frag'), $('tx-frag')];
  var stopLoading = frags.map(function (f) {
    f.setAttribute('aria-busy', 'true');
    return swLoading(f);
  });
  try {
    var parts = await Promise.all([
      fetchFragment('/dashboard/fragments/summary?month=' + month),
      fetchFragment('/dashboard/fragments/list?month=' + month +
        '&layout=' + (window.matchMedia('(min-width: 768px)').matches ? 'desktop' : 'mobile')),
    ]);
    $('summary-frag').innerHTML = parts[0];
    $('tx-frag').innerHTML = parts[1];
    mergeTxCache($('tx-frag'));
    syncAllCategoryOptions();
    swApplyDefaults('m-');
    updateManualPreview();
    return true;
  } catch (err) {
    showToast('Aktualisierung fehlgeschlagen – Seite wird neu geladen', 'error');
    throw err;
  } finally {
    frags.forEach(function (f) {
      f.removeAttribute('aria-busy');
    });
    stopLoading.forEach(function (off) {
      off();
    });
  }
}

window.__afterMutation = function () {
  return afterMutation(refreshDashboard);
};

// --- Klick-Delegation ---
document.addEventListener('click', async function (e) {
  var action = e.target.closest('[data-action]');
  if (action) {
    var name = action.getAttribute('data-action');
    if (name === 'open-settle') {
      openSheet('settlement-overlay');
      setTimeout(function () { $('s-amount').focus(); }, 150);
      return;
    }
    if (name === 'contribution') {
      var unbusy = busy(action);
      try {
        await postJson('/api/contribution', {});
        await afterMutation(refreshDashboard);
      } catch (err) {
        showToast(err.message, 'info');
        unbusy();
      }
      return;
    }
  }

  var closer = e.target.closest('[data-close]');
  if (closer) { closeSheet(closer.getAttribute('data-close')); return; }

  var quick = e.target.closest('[data-quick-settle]');
  if (quick) {
    $('s-amount').value = quick.getAttribute('data-amount');
    $('s-from').value = quick.getAttribute('data-from');
    rebuildRecipientOptions();
    $('s-to').value = quick.getAttribute('data-to');
    openSheet('settlement-overlay');
    setTimeout(function () { $('s-amount').focus(); }, 150);
    return;
  }

  var more = e.target.closest('[data-load-more]');
  if (more) {
    var moreLayout = window.matchMedia('(min-width: 768px)').matches ? 'desktop' : 'mobile';
    var unbusyMore = busy(more, 'Lade …');
    try {
      var html = await fetchFragment('/dashboard/fragments/list-more?month=' + window.__MONTH +
        '&layout=' + moreLayout +
        '&before_date=' + encodeURIComponent(more.getAttribute('data-before-date')) +
        '&before_id=' + encodeURIComponent(more.getAttribute('data-before-id')));
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      var moreItems = tmp.querySelector('[data-more-items]');
      var target = document.querySelector(
        moreLayout === 'desktop' ? '[data-tx-list-desktop]' : '[data-tx-list-mobile]'
      );
      if (moreItems && target) target.insertAdjacentHTML('beforeend', moreItems.innerHTML);
      mergeTxCache(tmp);
      // Cursor auch auf den Button der anderen Layout-Variante anwenden,
      // damit ein Layout-Wechsel (Resize) nichts doppelt nachlädt
      var newWrap = tmp.querySelector('[data-load-more-wrap]');
      var newBtn = newWrap ? newWrap.querySelector('[data-load-more]') : null;
      Array.prototype.forEach.call(document.querySelectorAll('[data-load-more]'), function (btn) {
        if (newBtn) {
          btn.setAttribute('data-before-date', newBtn.getAttribute('data-before-date'));
          btn.setAttribute('data-before-id', newBtn.getAttribute('data-before-id'));
        }
      });
      var wrap = more.closest('[data-load-more-wrap]');
      if (newWrap) wrap.replaceWith(newWrap);
      else if (wrap) wrap.remove();
    } catch (err) {
      showToast(err.message, 'error');
      unbusyMore();
    }
    return;
  }

  var menu = e.target.closest('[data-card-menu]');
  if (menu) {
    var tx = txFromEl(menu);
    if (!tx) return;
    // Bearbeiten-/Wiederkehrend-/Löschen-Button des Aktions-Sheets mit den echten Werten füllen
    var editSheetBtn = document.querySelector('#card-actions-overlay [data-edit]');
    var mrSheetBtn = document.querySelector('#card-actions-overlay [data-make-recurring]');
    var delSheetBtn = document.querySelector('#card-actions-overlay [data-delete]');
    if (editSheetBtn) editSheetBtn.setAttribute('data-tx-id', tx.id);
    if (mrSheetBtn) {
      mrSheetBtn.setAttribute('data-tx-id', tx.id);
      mrSheetBtn.classList.toggle('hidden', !(tx.type !== 'transfer' && !tx.recurring_id));
    }
    if (delSheetBtn) delSheetBtn.setAttribute('data-delete', tx.id);
    openSheet('card-actions-overlay');
    return;
  }

  var editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    var editTx = txFromEl(editBtn);
    if (!editTx) return;
    openEditModal(editTx);
    return;
  }

  var mrBtn = e.target.closest('[data-make-recurring]');
  if (mrBtn) {
    var mrTx = txFromEl(mrBtn);
    if (!mrTx) return;
    closeSheet('card-actions-overlay');
    openMakeRecurringModal(mrTx);
    return;
  }

  var delBtn = e.target.closest('[data-delete]');
  if (delBtn) {
    if (!(await confirmSheet({
      title: 'Transaktion löschen?',
      message: 'Diese Buchung wird unwiderruflich gelöscht.',
      confirmText: 'Löschen',
      danger: true,
    }))) return;
    try {
      await postJson('/api/transactions/' + delBtn.getAttribute('data-delete'), {}, 'DELETE');
      await afterMutation(refreshDashboard);
    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }
});

// --- Submit-Delegation ---
document.addEventListener('submit', async function (e) {
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  if (form.id === 'manual-form') {
    e.preventDefault();
    var amount = validAmount($('m-amount'));
    if (!amount) return;
    var body = {
      amount: amount,
      type: $('m-type').value,
      scope: $('m-scope').value,
      paid_from: $('m-paid-from').value,
      category: $('m-type').value === 'income' ? (window.__INCOME_CATEGORY || 'Einnahme') : $('m-category').value,
      description: $('m-description').value,
    };
    var date = $('m-date').value;
    if (date) body.date = date;
    var unbusy = busy(btn);
    try {
      await postJson('/api/transactions', body);
      swSaveDefaults(body.scope, body.paid_from);
      $('m-amount').value = '';
      $('m-description').value = '';
      updateManualPreview();
      showToast('Gespeichert ✓', 'ok');
      await afterMutation(refreshDashboard);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unbusy();
    }
    return;
  }

  if (form.id === 'settlement-form') {
    e.preventDefault();
    var amount = validAmount($('s-amount'));
    if (!amount) return;
    var unbusy = busy(btn);
    try {
      await postJson('/api/settlements', {
        amount: amount,
        from: $('s-from').value,
        to: $('s-to').value,
      });
      closeSheet('settlement-overlay');
      showToast('Ausgleich gebucht ✓', 'ok');
      await afterMutation(refreshDashboard);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unbusy();
    }
    return;
  }

  if (form.id === 'make-recurring-form') {
    e.preventDefault();
    if (!MAKE_RECURRING_TX) return;
    var body = { frequency: $('mr-frequency').value };
    var endDate = $('mr-end-date').value;
    if (endDate) body.end_date = endDate;
    var unbusy = busy(btn);
    try {
      await postJson('/api/transactions/' + MAKE_RECURRING_TX.id + '/make-recurring', body);
      MAKE_RECURRING_TX = null;
      closeSheet('make-recurring-overlay');
      showToast('Wiederkehrend eingerichtet ✓', 'ok');
      await afterMutation(refreshDashboard);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unbusy();
    }
    return;
  }

  if (form.id === 'edit-form') {
    e.preventDefault();
    if (!EDITING_ID) return;
    var amount = validAmount($('e-amount'));
    if (!amount) return;
    var body = {
      amount: amount,
      type: $('e-type').value,
      scope: $('e-scope').value,
      paid_from: $('e-paid-from').value,
      category: $('e-type').value === 'income' ? (window.__INCOME_CATEGORY || 'Einnahme') : $('e-category').value,
      description: $('e-description').value,
    };
    var date = $('e-date').value;
    if (date) body.date = date + EDITING_TIME;
    var unbusy = busy(btn);
    try {
      await postJson('/api/transactions/' + EDITING_ID, body, 'PUT');
      EDITING_ID = null;
      closeSheet('edit-overlay');
      showToast('Änderungen gespeichert ✓', 'ok');
      await afterMutation(refreshDashboard);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      unbusy();
    }
    return;
  }
});
});
`;

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export const DashboardView: FC<DashboardProps> = ({
  userName,
  householdName,
  members,
  month,
  monthLabel,
  prevMonth,
  nextMonth,
  privateBalance,
  jointPot,
  sharedMonth,
  debts,
  myContribution,
  contributionBooked,
  transactions,
  today,
  hasMore,
  recurringCount,
  layout = 'mobile',
}) => {
  const others = members.filter((m) => m.name !== userName);
  const recipientOptions: { id: number | 'me' | 'joint'; name: string }[] = [
    { id: 'me', name: `${userName} (du)` },
    ...others,
    { id: 'joint', name: 'Gemeinschaftskonto' },
  ];
  const payerOptions: { id: number | 'me'; name: string }[] = [{ id: 'me', name: 'Ich' }, ...others];

  return (
    <Layout title="Dashboard">
      <CategoryGlobals />
      <main class="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-8 md:pb-8">
        {/* Schlanker Kontext-Kopf: kein Brand, nur Monat (Content-First) + kompakter Switcher */}
        <header class="mb-4 flex items-center justify-between gap-3 md:hidden">
          <div class="min-w-0">
            <h1 class="font-serif text-xl font-semibold tracking-tight text-slate-900">{monthLabel}</h1>
            <p class="text-xs text-slate-500">SmartWallet · {householdName}</p>
          </div>
          <MonthSwitcher basePath="/dashboard" month={month} monthLabel={monthLabel} prevMonth={prevMonth} nextMonth={nextMonth} compact />
        </header>

        {/* Desktop-Kopf: volle Navigation + Begrüßung */}
        <header class="mb-8 hidden items-center justify-between md:flex">
          <div>
            <h1 class="font-serif text-2xl font-semibold tracking-tight text-slate-900">
              SmartWallet
            </h1>
            <p class="text-sm text-slate-500">
              Hallo {userName}, hier ist der Überblick für „{householdName}“.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <MonthSwitcher basePath="/dashboard" month={month} monthLabel={monthLabel} prevMonth={prevMonth} nextMonth={nextMonth} />
            <DesktopNav page="dashboard" month={month} recurringCount={recurringCount} />
            <UserChip userName={userName} />
          </div>
        </header>

        <div id="summary-frag" class="md:mb-6">
          <SummaryCards
            members={members}
            monthLabel={monthLabel}
            privateBalance={privateBalance}
            jointPot={jointPot}
            sharedMonth={sharedMonth}
            debts={debts}
            myContribution={myContribution}
            contributionBooked={contributionBooked}
          />
        </div>

        <MagicSheet />

        <div id="tx-frag">
          <TxList monthLabel={monthLabel} transactions={transactions} today={today} hasMore={hasMore} layout={layout} />
        </div>

        {/* Transaktions-Aktionsliste (Bearbeiten/Löschen in der Daumenzone) */}
        <div id="card-actions-overlay" class="fixed inset-0 z-50 hidden">
          <div class="absolute inset-0 bg-slate-900/40" data-close="card-actions-overlay"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="card-actions-title"
            class="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 shadow-xl"
          >
            <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" aria-hidden="true"></div>
            <h2 id="card-actions-title" class="mb-3 text-base font-semibold text-slate-800">Transaktion</h2>
            <div class="grid gap-3">
              <button type="button" data-edit class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-base font-semibold text-white transition active:scale-95">
                Bearbeiten
              </button>
              <button type="button" data-make-recurring class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 text-base font-semibold text-violet-700 transition active:scale-95">
                🔁 Wiederkehrend einrichten
              </button>
              <button type="button" data-delete class="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-base font-semibold text-red-600 transition active:scale-95">
                Löschen
              </button>
              <button type="button" data-close="card-actions-overlay" class="min-h-[52px] rounded-2xl border border-slate-200 bg-white text-base font-semibold text-slate-600 transition active:scale-95">
                Abbrechen
              </button>
            </div>
          </div>
        </div>

        {/* Ausgleichszahlung */}
        <div id="settlement-overlay" class="fixed inset-0 z-50 hidden">
          <div class="absolute inset-0 bg-slate-900/40" data-close="settlement-overlay"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settlement-title"
            class="safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[36rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          >
            <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
            <div class="mb-3 flex items-start justify-between">
              <h2 id="settlement-title" class="text-base font-semibold text-slate-800">Ausgleichszahlung</h2>
              <button
                type="button"
                data-close="settlement-overlay"
                aria-label="Ausgleichszahlung schließen"
                class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-5 w-5" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <form id="settlement-form" class="grid gap-3 sm:grid-cols-4">
              <div>
                <label for="s-from" class="mb-1 block text-xs text-slate-500">Zahlender</label>
                <select id="s-from" class={INPUT_CLASS} data-members={JSON.stringify(payerOptions)}>
                  {payerOptions.map((m) => (
                    <option value={m.id === 'me' ? 'me' : m.id} selected={m.id === 'me'}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label for="s-to" class="mb-1 block text-xs text-slate-500">Empfänger</label>
                <select id="s-to" class={INPUT_CLASS} data-members={JSON.stringify(recipientOptions)}></select>
              </div>
              <div>
                <label for="s-amount" class="mb-1 block text-xs text-slate-500">Betrag (€)</label>
                <input id="s-amount" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required placeholder="z. B. 30" class={INPUT_CLASS} />
              </div>
              <button type="submit" class="btn-primary w-full">
                Ausgleich buchen
              </button>
            </form>
          </div>
        </div>

        {/* Bearbeiten */}
        <div id="edit-overlay" class="fixed inset-0 z-50 hidden">
          <div class="absolute inset-0 bg-slate-900/40" data-close="edit-overlay"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
            class="safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[42rem] sm:max-w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          >
            <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
            <div class="mb-3 flex items-start justify-between">
              <h2 id="edit-title" class="text-base font-semibold text-slate-800">Transaktion bearbeiten</h2>
              <button
                type="button"
                data-close="edit-overlay"
                aria-label="Bearbeiten abbrechen"
                class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-5 w-5" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <form id="edit-form" class="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <label class="block">
                <span class={LABEL_CLASS}>Betrag</span>
                <input id="e-amount" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" required placeholder="z. B. 12,50" class={INPUT_CLASS} />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Beschreibung</span>
                <input id="e-description" type="text" maxlength={200} placeholder="Beschreibung" autocomplete="off" class={INPUT_CLASS} />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Art</span>
                <select id="e-type" class={INPUT_CLASS}>
                  <option value="expense">Ausgabe</option>
                  <option value="income">Einnahme</option>
                  <option value="transfer">Überweisung</option>
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Bereich</span>
                <select id="e-scope" class={INPUT_CLASS}>
                  <option value="shared">Gemeinsam</option>
                  <option value="personal">Persönlich</option>
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Konto</span>
                <select id="e-paid-from" class={INPUT_CLASS}>
                  <option value="joint">Gemeinschaftskonto</option>
                  <option value="private">Privatkonto</option>
                </select>
              </label>
              <label id="e-category-field" class="block">
                <span class={LABEL_CLASS}>Kategorie</span>
                <CategorySelect id="e-category" />
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Datum</span>
                <input id="e-date" type="date" autocomplete="off" class={INPUT_CLASS} />
              </label>
              <div class="flex gap-2 sm:col-span-3 lg:col-span-4">
                <button type="submit" class="btn-primary flex-1">
                  Änderungen speichern
                </button>
                <button type="button" data-close="edit-overlay" class="btn-secondary">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Wiederkehrend einrichten */}
        <div id="make-recurring-overlay" class="fixed inset-0 z-50 hidden">
          <div class="absolute inset-0 bg-slate-900/40" data-close="make-recurring-overlay"></div>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="make-recurring-title"
            class="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-5 shadow-xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[28rem] sm:max-w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          >
            <div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden="true"></div>
            <div class="mb-3 flex items-start justify-between">
              <h2 id="make-recurring-title" class="text-base font-semibold text-slate-800">Wiederkehrend einrichten</h2>
              <button
                type="button"
                data-close="make-recurring-overlay"
                aria-label="Abbrechen"
                class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" class="h-5 w-5" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <p id="mr-summary" class="mb-3 text-sm text-slate-500"></p>
            <form id="make-recurring-form" class="grid gap-3">
              <label class="block">
                <span class={LABEL_CLASS}>Rhythmus</span>
                <select id="mr-frequency" class={INPUT_CLASS}>
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option value={opt.value} selected={opt.value === 'monthly'}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <label class="block">
                <span class={LABEL_CLASS}>Enddatum (optional)</span>
                <input id="mr-end-date" type="date" autocomplete="off" class={INPUT_CLASS} />
              </label>
              <div class="flex gap-2">
                <button type="submit" class="btn-primary flex-1">
                  Einrichten
                </button>
                <button type="button" data-close="make-recurring-overlay" class="btn-secondary">
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      <BottomNav page="dashboard" month={month} />

      <script dangerouslySetInnerHTML={{ __html: 'window.__MONTH = "' + month + '";window.__MEMBERS = ' + JSON.stringify(members.length) + ';' }} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
};
