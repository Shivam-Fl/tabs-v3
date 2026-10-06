/**
 * How a stored date reads (TR-11, IAC-1).
 *
 * `docs/ui.md` is explicit that dates are shown the way people say them — "13 Jan", "Yesterday" —
 * and never as `2026-01-13`. That rule is one function rather than a `toLocaleDateString` written
 * into the editor, because it is also a rule about *what the answer depends on*: a label computed
 * from a clock disagrees between the server render and the hydrated client, so `today` is a
 * parameter. The caller computes it once, on the client, and passes the same string into both
 * renders.
 *
 * The arithmetic is calendar arithmetic on UTC integers, the same way `lib/expenses/validation`
 * checks a date against the calendar: `Date.UTC` on a y/m/d triple, compared back against its own
 * parts, so 2026-02-30 is not a date and neither is 2026-13-01. No float is involved, and the
 * "days apart" question is asked by subtracting the two day numbers rather than by dividing a
 * millisecond difference, which is what a daylight-saving change would make wrong.
 *
 * Anything it cannot read it hands back untouched rather than throwing. A label is decoration on
 * a value the ledger already holds, and a screen that went down because one row's date was odd is
 * a worse failure than a row showing what it stored.
 */

import { isRealCalendarDay, type CalendarDay } from '../dates';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DAY_MS = 86_400_000;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` as a real day on the calendar, or null. */
function parseCalendarDate(value: string): CalendarDay | null {
  const match = CALENDAR_DATE.exec(value.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return isRealCalendarDay(year, month, day) ? { year, month, day } : null;
}

/** How many days into the epoch a calendar date is, as a whole number. */
function dayNumber(date: CalendarDay): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / DAY_MS);
}

/**
 * `date` in words, read against `today`.
 *
 * Today, yesterday and tomorrow are named, because those are the three a person is most likely to
 * be entering and the three a raw date reads worst for — and every named day carries its absolute
 * day and month beside it ("Today · 5 Oct"). The relative word never stands alone, because it is
 * only ever as right as the `today` it was handed: the group page's rows are rendered on the
 * server, where "today" is the UTC clock, so a viewer a zone away can be reading their own
 * yesterday under the word "Today". The absolute half is the same day the row's `datetime`
 * attribute holds, so such a row is never *wrong*, only less chatty.
 *
 * Everything else is the day and the month ("13 Jan"), with the year added only when it is not
 * `today`'s — a date from another year is the one case where the day and month alone are
 * ambiguous. That rule is the absolute half's rule wherever it appears, so a named day across a
 * year boundary reads "Tomorrow · 1 Jan 2027".
 *
 * A date it cannot read, or a `today` it cannot read, comes back as the input unchanged.
 *
 * This is the editor preview's ladder, and it is deliberately not `formatExpenseDate`'s
 * (`lib/dates.ts`): the preview is read while a date is being typed against the viewer's own
 * local day, so it pairs the relative word with the absolute day and names Tomorrow. Ledger rows
 * stand alone and read Today, Yesterday, a weekday or a date.
 */
export function humanDateLabel(date: string, today: string): string {
  const target = parseCalendarDate(date);
  const base = parseCalendarDate(today);
  if (target === null || base === null) return date;

  const month = MONTHS[target.month - 1] ?? '';
  const absolute =
    target.year === base.year
      ? `${target.day} ${month}`
      : `${target.day} ${month} ${target.year}`;

  const distance = dayNumber(target) - dayNumber(base);
  if (distance === 0) return `Today · ${absolute}`;
  if (distance === -1) return `Yesterday · ${absolute}`;
  if (distance === 1) return `Tomorrow · ${absolute}`;

  return absolute;
}
