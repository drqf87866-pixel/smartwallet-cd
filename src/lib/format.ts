/** Gemeinsame Formatierer für alle Views (Euro-Beträge, Datum/Uhrzeit, Monat). */

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const fmt = (n: number) => eur.format(n);

const dayFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso));
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));

const dateFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});
export const fmtDate = (dateOnly: string) => dateFmt.format(new Date(dateOnly + 'T12:00:00Z'));

const monthShortFmt = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });
export const fmtMonthShort = (ym: string) => monthShortFmt.format(new Date(`${ym}-01T00:00:00Z`));
