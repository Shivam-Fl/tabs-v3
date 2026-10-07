/**
 * How a date and an instant become words (IAC-7, TR-11).
 *
 * Nothing in this module owns a clock. That is the whole point of it: a server in one zone
 * rendering "Yesterday" for a reader in another is a date the reader knows is wrong, and a
 * relative label decided at render time on the server is a label that goes stale in the tab it
 * was printed in. So every function here takes the day or the instant to judge *against* — the
 * caller supplies it, the client island that knows the viewer's zone supplies it — and every
 * branch below is testable without freezing the machine's time.
 *
 * The locale is pinned rather than left to the runtime. `undefined` would print the server's
 * locale for the first paint and the viewer's after hydration, and a date that changes shape
 * mid-page is exactly the layout shift ui.md bans; en-GB is also the shape the copy already
 * uses ("3 Oct", "3 Oct 2025").
 *
 * Two kinds of value are formatted here and they are not interchangeable:
 *
 * - a **calendar date** (`YYYY-MM-DD`, what an expense stores) has no instant and no zone — it
 *   is the day the receipt says, and shifting it into anybody's timezone would be inventing a
 *   fact;
 * - an **instant** (an ISO timestamp, what the ledger stores) is a moment, and the only honest
 *   way to print it is in the zone of the person reading it.
 *
 * The functions that read calendar fields do so through UTC so their answer is the same string
 * on every machine, which is what makes the server's first paint and the client's first paint
 * agree — see `formatZoneNeutralDate`.
 */

const LOCALE = 'en-GB';

/**
 * The head of a date-bearing string: `2026-10-06` itself, which is what an expense stores, or
 * the date part of an ISO instant. A `toISOString()` timestamp is always UTC, so its first ten
 * characters are its UTC day — the field this module formats, not a zone conversion.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

const MS_PER_DAY = 86_400_000;

const ABSOLUTE_DAY = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const DAY_MONTH_YEAR = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The one formatter that is allowed a zone, and it is the viewer's: no `timeZone` option. */
const VIEWER_STAMP = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * Whether a year/month/day triple is a day on the calendar. Round-tripped through `Date.UTC`,
 * which normalizes an impossible day into the next month: a triple that does not come back as the
 * three numbers that went in was never a date. The one validator `lib/money/human-date.ts` shares.
 */
export function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/**
 * The calendar day at the head of a date string, or null when there is not one — including for a
 * string like `2026-02-31`, which matches the pattern and is not a day anybody has lived.
 */
function calendarDay(raw: string): CalendarDay | null {
  const match = ISO_DAY.exec(raw.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return isRealCalendarDay(year, month, day) ? { year, month, day } : null;
}

function utcMidnight(day: CalendarDay): Date {
  return new Date(Date.UTC(day.year, day.month - 1, day.day));
}

/**
 * The date as an absolute, zone-neutral day: "3 Oct 2025".
 *
 * This is what the server renders and what the client renders before it has mounted, and the two
 * have to be the same string or React re-hydrates into a mismatch — so the day is read from the
 * string itself (its own fields for a calendar date, its UTC fields for an instant) and no clock
 * or timezone is consulted at all. It carries no zone label because it makes no claim about one.
 *
 * A string this cannot read comes back unchanged, which keeps a malformed value visible in the
 * page rather than replaced by a fabricated date.
 */
export function formatZoneNeutralDate(raw: string): string {
  const day = calendarDay(raw);
  return day === null ? raw : ABSOLUTE_DAY.format(utcMidnight(day));
}

/**
 * An expense's date the way somebody would say it, judged against `today` and never against a
 * clock this module would have to read.
 *
 * `today` is the viewer's own calendar day as `YYYY-MM-DD`, which is the only input that makes
 * "Today" mean today wherever the reader is. The ladder is the one ui.md asks for — today,
 * yesterday, the weekday inside the last week, then the date — and it is the *last seven days*
 * rather than "this week", so a Monday expense read on a Tuesday says "Yesterday" and a Tuesday
 * expense read the next Monday says "Mon" without either answer depending on where the week is
 * held to start. Past that the year is shown only when it is not the current one.
 *
 * This is the ladder for ledger rows, and it is deliberately not `humanDateLabel`'s
 * (`lib/money/human-date.ts`): a row stands alone, so it says Today, Yesterday, a weekday or a
 * date. The editor's preview is read while the date is being typed against the viewer's own
 * local day, so it pairs the relative word with the absolute day ("Today · 6 Oct") and also names
 * Tomorrow, which a stored row never needs.
 */
export function formatExpenseDate(date: string, today: string): string {
  const day = calendarDay(date);
  if (day === null) return date;

  const todayDay = calendarDay(today);
  if (todayDay !== null) {
    const elapsed = Math.round(
      (utcMidnight(todayDay).getTime() - utcMidnight(day).getTime()) / MS_PER_DAY,
    );

    if (elapsed === 0) return 'Today';
    if (elapsed === 1) return 'Yesterday';
    if (elapsed > 1 && elapsed < 7) return WEEKDAY.format(utcMidnight(day));
    if (todayDay.year === day.year) return DAY_MONTH.format(utcMidnight(day));
  }

  return DAY_MONTH_YEAR.format(utcMidnight(day));
}

/**
 * A ledger instant the way the person reading it experiences it: how long ago it was, and past a
 * week the moment itself in their zone with no zone label.
 *
 * `now` is the viewer's clock, handed in for the reason this module has no clock of its own. The
 * buckets are calendar-free because they are distances, so nothing here has to know where anybody
 * is — the one zone-dependent line is the absolute at the end, and that is deliberately the
 * viewer's, because "3 Oct 2025" is more useful to them than the same moment in UTC.
 *
 * A future instant — a row written by a server whose clock is a little ahead — reads as "Just
 * now" rather than as a negative age. A string that is not an instant comes back unchanged.
 */
export function formatViewerTimestamp(instant: string, now: Date): string {
  const at = new Date(instant);
  const atMs = at.getTime();
  if (Number.isNaN(atMs)) return instant;

  const seconds = Math.floor((now.getTime() - atMs) / 1000);
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return VIEWER_STAMP.format(at);
}

/**
 * The viewer's own calendar day as `YYYY-MM-DD`.
 *
 * This is the one function here that reads a clock, and it is the caller's job to be holding it:
 * it exists so a client island can hand `formatExpenseDate` the reader's today rather than the
 * server's. Local fields on purpose — the reader's day is the one they are living in.
 */
export function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
