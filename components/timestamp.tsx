'use client';

import { useEffect, useState } from 'react';
import { formatExpenseDate, formatViewerTimestamp, formatZoneNeutralDate, localDay } from '../lib/dates';

/**
 * The two times the product shows, as islands that know where the reader is (IAC-7).
 *
 * ui.md bans developer artefacts — ISO dates, UTC timestamps — and asks for dates people say
 * ("13 Jan", "Yesterday") in the viewer's own zone. A server component cannot do either: it does
 * not know the reader's timezone, and a relative label it computed would go stale in the tab it
 * was printed in. So both of these render a **zone-neutral absolute** date, which is the same
 * string on the server and in the browser before hydration, and then upgrade to the viewer's
 * answer after mount. That order is the whole design: rendering the viewer's answer first would
 * be a hydration mismatch, and rendering the server's answer forever is the UTC label this
 * ticket exists to remove.
 *
 * They live in their own module rather than beside a screen for the reason `ui.tsx` does: the
 * group page, the activity excerpt and `/activity` all render feed times, and a shared module
 * that imported from a route would make that route a dependency of everything.
 *
 * `dateTime` is set on both from the value they were handed, so the machine-readable instant is
 * the same before and after the upgrade — assistive technology and anything reading the markup
 * see one stable answer even while the printed one changes.
 */

/**
 * A ledger instant: how long ago it was, then the moment itself past a week.
 *
 * `useEffect` and not `useLayoutEffect`, so the server's markup is never second-guessed on the
 * client during hydration. The effect re-runs when the instant changes, which is what makes a row
 * that arrives in a later render re-read its own age rather than keep the first one's.
 */
export function Timestamp({ instant }: { instant: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, [instant]);

  return (
    <time dateTime={instant}>
      {now === null ? formatZoneNeutralDate(instant) : formatViewerTimestamp(instant, now)}
    </time>
  );
}

/**
 * An expense's date: "Today", "Yesterday", the weekday, or the date.
 *
 * The upgrade passes the reader's own calendar day, so Today means today where they are rather
 * than where the server is. The expense's day is a calendar date and is never shifted into a
 * zone — it is the day the receipt says.
 */
export function ExpenseDate({ date }: { date: string }) {
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    setToday(localDay(new Date()));
  }, [date]);

  return (
    <time dateTime={date}>
      {today === null ? formatZoneNeutralDate(date) : formatExpenseDate(date, today)}
    </time>
  );
}
