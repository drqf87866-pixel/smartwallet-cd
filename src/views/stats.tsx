import type { FC } from 'hono/jsx';
import type { TransactionScope } from '../types';
import { Layout } from './layout';
import { BottomNav, MagicSheet, UserChip } from './shared';
import { fmt, fmtDay, fmtMonthShort } from '../lib/format';

export type CategorySlice = { category: string; spent: number };
export type HistoryMonth = { ym: string; income: number; expense: number };
export type TopExpense = {
  description: string;
  category: string;
  amount: number;
  date: string;
  scope: TransactionScope;
  created_by: string;
};

export type StatsProps = {
  userName: string;
  householdName: string;
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  categories: CategorySlice[];
  categoryTotal: number;
  memberCount: number;
  history: HistoryMonth[];
  topExpenses: TopExpense[];
};

const DONUT_RADIUS = 45;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const PALETTE = [
  'hsl(16, 55%, 50%)', 'hsl(148, 28%, 40%)', 'hsl(38, 55%, 48%)', 'hsl(5, 55%, 48%)',
  'hsl(210, 30%, 52%)', 'hsl(320, 30%, 48%)', 'hsl(178, 35%, 38%)', 'hsl(268, 28%, 52%)',
  'hsl(75, 30%, 38%)', 'hsl(350, 40%, 55%)', 'hsl(225, 25%, 48%)', 'hsl(30, 45%, 42%)',
];

/** Kategorien-Donut: Segmente per stroke-dasharray, Legende mit Anteilen. */
const CategoryDonut: FC<{ slices: CategorySlice[]; total: number }> = ({ slices, total }) => {
  if (total <= 0) {
    return <p class="py-8 text-center text-sm text-slate-500">Keine Ausgaben in diesem Monat.</p>;
  }
  let offset = 0;
  const segments = slices.map((slice, index) => {
    const dash = (slice.spent / total) * DONUT_CIRCUMFERENCE;
    const segment = { ...slice, dash, offset, color: PALETTE[index % PALETTE.length] };
    offset += dash;
    return segment;
  });

  return (
    <div class="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <svg viewBox="0 0 120 120" class="h-44 w-44 shrink-0" role="img" aria-label="Ausgaben nach Kategorie">
        <g transform="rotate(-90 60 60)">
          {segments.map((segment) => (
            <circle
              cx="60"
              cy="60"
              r={DONUT_RADIUS}
              fill="none"
              stroke={segment.color}
              stroke-width="16"
              stroke-dasharray={`${Math.max(segment.dash - 0.6, 0)} ${DONUT_CIRCUMFERENCE - Math.max(segment.dash - 0.6, 0)}`}
              stroke-dashoffset={-segment.offset}
            >
              <title>{`${segment.category}: ${fmt(segment.spent)}`}</title>
            </circle>
          ))}
        </g>
        <text x="60" y="57" text-anchor="middle" class="fill-slate-500" style="font-size:7px">Ausgaben</text>
        <text x="60" y="68" text-anchor="middle" class="fill-slate-700" style="font-size:10px;font-weight:700">
          {fmt(total)}
        </text>
      </svg>
      <ul class="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {segments.map((segment) => (
          <li class="flex items-center justify-between gap-2">
            <span class="flex min-w-0 items-center gap-2">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" style={'background:' + segment.color}></span>
              <span class="truncate text-slate-600">{segment.category}</span>
            </span>
            <span class="whitespace-nowrap tabular-nums text-slate-500">
              {fmt(segment.spent)} · {Math.round((segment.spent / total) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** 6-Monats-Verlauf: gruppierte Balken (Einnahmen/Ausgaben) als SVG. */
const HistoryBars: FC<{ history: HistoryMonth[] }> = ({ history }) => {
  const max = Math.max(1, ...history.map((row) => Math.max(row.income, row.expense)));
  const plotHeight = 110;
  const baseline = 126;
  const columnWidth = 360 / history.length;

  return (
    <div>
      <svg viewBox="0 0 360 140" class="w-full" role="img" aria-label="Verlauf der letzten 6 Monate">
        <line x1="0" y1={baseline} x2="360" y2={baseline} stroke="hsl(32, 15%, 85%)" stroke-width="1" />
        {history.map((row, index) => {
          const incomeHeight = (row.income / max) * plotHeight;
          const expenseHeight = (row.expense / max) * plotHeight;
          const x = index * columnWidth + columnWidth / 2;
          return (
            <g>
              <title>
                {`${fmtMonthShort(row.ym)}: Einnahmen ${fmt(row.income)} · Ausgaben ${fmt(row.expense)}`}
              </title>
              <rect
                x={x - 8}
                y={baseline - incomeHeight}
                width="7"
                height={incomeHeight}
                rx="1.5"
                fill="hsl(148, 30%, 40%)"
              />
              <rect
                x={x + 1}
                y={baseline - expenseHeight}
                width="7"
                height={expenseHeight}
                rx="1.5"
                fill="#e11d48"
              />
              <text x={x} y={baseline + 12} text-anchor="middle" class="fill-slate-500" style="font-size:8px">
                {fmtMonthShort(row.ym)}
              </text>
            </g>
          );
        })}
      </svg>
      <p class="mt-1 flex items-center justify-center gap-4 text-xs text-slate-500">
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden="true"></span> Einnahmen
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-full bg-rose-600" aria-hidden="true"></span> Ausgaben
        </span>
      </p>
    </div>
  );
};

export const StatsView: FC<StatsProps> = ({
  userName,
  householdName,
  month,
  monthLabel,
  prevMonth,
  nextMonth,
  categories,
  categoryTotal,
  memberCount,
  history,
  topExpenses,
}) => {
  const incomeTotal = history.find((row) => row.ym === month)?.income ?? 0;
  const balance = incomeTotal - categoryTotal;

  return (
    <Layout title="Statistik">
      <main class="mx-auto max-w-6xl px-4 pb-44 pt-4 sm:px-8 md:pb-8">
        {/* Schlanker Kontext-Kopf (Content-First, kein Brand auf Mobile) */}
        <header class="mb-4 md:hidden">
          <h1 class="font-serif text-xl font-semibold tracking-tight text-slate-900">Statistik</h1>
          <p class="text-xs text-slate-500">{householdName}</p>
        </header>

        {/* Desktop-Kopf */}
        <header class="mb-8 hidden items-center justify-between md:flex">
          <div>
            <h1 class="font-serif text-2xl font-semibold tracking-tight text-slate-900">Statistik</h1>
            <p class="text-sm text-slate-500">
              Hallo {userName}, hier ist die Analyse für „{householdName}“.
            </p>
          </div>
          <UserChip userName={userName} />
        </header>

        {/* Monatsbilanz – Hauptkennzahl der Seite */}
        <section class="card mb-4 !p-0 overflow-hidden md:hidden">
          <div class="bg-gradient-to-br from-slate-800 to-slate-900 px-5 py-6 text-white">
            <p class="text-sm font-medium text-slate-300">Bilanz · {monthLabel}</p>
            <p class={'mt-1 font-serif text-4xl font-semibold tabular-nums tracking-tight ' + (balance >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
              {balance >= 0 ? '+' : '−'}
              {fmt(Math.abs(balance))}
            </p>
            <div class="mt-4 grid grid-cols-2 gap-3">
              <div class="rounded-xl bg-white/10 px-3 py-2.5">
                <p class="text-[11px] text-slate-300">Einnahmen</p>
                <p class="font-serif text-lg font-semibold tabular-nums text-emerald-400">{fmt(incomeTotal)}</p>
              </div>
              <div class="rounded-xl bg-white/10 px-3 py-2.5">
                <p class="text-[11px] text-slate-300">Ausgaben</p>
                <p class="font-serif text-lg font-semibold tabular-nums text-rose-400">{fmt(categoryTotal)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Kategorien – priorisiert: Donut nur für die Top-Kategorien lesbar */}
        <section class="card mb-4">
          <h2 class="mb-4 text-sm font-medium text-slate-500">Ausgaben nach Kategorie · {monthLabel}</h2>
          <CategoryDonut slices={categories} total={categoryTotal} />
        </section>

        <section class="card mb-4">
          <h2 class="mb-4 text-sm font-medium text-slate-500">Verlauf der letzten 6 Monate</h2>
          <HistoryBars history={history} />
        </section>

        <section class="card mb-4">
          <h2 class="mb-2 text-sm font-medium text-slate-500">Top-Ausgaben · {monthLabel}</h2>
          {memberCount > 1 && (
            <p class="mb-2 text-xs text-slate-500">Bei gemeinsamen Ausgaben zählt dein Anteil (1/{memberCount}).</p>
          )}
          {topExpenses.length === 0 ? (
            <p class="py-6 text-center text-sm text-slate-500">Keine Ausgaben in diesem Monat.</p>
          ) : (
            <ol class="divide-y divide-slate-100">
              {topExpenses.map((expense, index) => (
                <li class="flex items-center justify-between gap-3 py-2.5">
                  <span class="flex min-w-0 items-center gap-3">
                    <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                      {index + 1}
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-slate-700">
                        {expense.description || expense.category}
                      </span>
                      <span class="block text-xs text-slate-500">
                        {fmtDay(expense.date)} · {expense.category} · {expense.created_by}
                        {expense.scope === 'shared' && memberCount > 1 ? ' · Anteil' : ''}
                      </span>
                    </span>
                  </span>
                  <span class="whitespace-nowrap text-sm font-semibold tabular-nums text-red-600">
                    −{fmt(expense.amount)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <MagicSheet />
      </main>

      {/* Daumenzonen-Bar: Monatsnavigation unten, fix über der BottomNav */}
      <nav
        aria-label="Monatsnavigation"
        class="fixed inset-x-0 bottom-[4.5rem] z-20 flex items-center justify-between gap-2 border-t border-slate-200/70 bg-white/95 px-4 py-2.5 backdrop-blur md:hidden"
        style="padding-bottom: calc(0.625rem + env(safe-area-inset-bottom, 0px))"
      >
        <a
          href={'/stats?month=' + prevMonth}
          aria-label="Voriger Monat"
          class="flex h-11 min-w-[88px] items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-700 active:bg-slate-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" class="h-4 w-4" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span class="sr-only">Voriger Monat</span>
        </a>
        <span class="flex-1 text-center text-sm font-semibold text-slate-800">{monthLabel}</span>
        <a
          href={'/stats?month=' + nextMonth}
          aria-label="Nächster Monat"
          class="flex h-11 min-w-[88px] items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-700 active:bg-slate-50"
        >
          <span class="sr-only">Nächster Monat</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" class="h-4 w-4" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </a>
      </nav>

      <BottomNav page="stats" month={month} />
    </Layout>
  );
};
