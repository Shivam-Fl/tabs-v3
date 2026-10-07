import { describe, expect, it } from 'vitest';
import { formatExpenseDate } from '../dates';
import { humanDateLabel } from './human-date';

/**
 * The human reading of a date (IAC-1).
 *
 * `today` is an argument rather than a clock read, so every case here is the same case on every
 * machine at every hour — which is the property the signature exists for, and the only way a
 * "Yesterday" assertion can be written at all.
 *
 * The three things pinned: the three named days and where their edges are, the day-month (and
 * day-month-year) reading for everything else, and that a value it cannot read is handed back
 * rather than thrown — a label is decoration on a value the ledger already holds.
 *
 * A named day is asserted with the absolute half it carries, because that half is the claim the
 * label makes when the relative word is read on somebody else's clock: the server that renders a
 * group row knows only the UTC day, so "Today · 5 Oct" tells a viewer a zone away both what the
 * reader calls the day they are entering and which day the row is actually about.
 */

describe('the three named days', () => {
  it('names today, yesterday and tomorrow, each with its absolute date', () => {
    expect(humanDateLabel('2026-10-05', '2026-10-05')).toBe('Today · 5 Oct');
    expect(humanDateLabel('2026-10-04', '2026-10-05')).toBe('Yesterday · 4 Oct');
    expect(humanDateLabel('2026-10-06', '2026-10-05')).toBe('Tomorrow · 6 Oct');
  });

  it('crosses a month boundary and a year boundary in both directions', () => {
    // The edge a string comparison or a "same month" shortcut would get wrong: 1 Jan is yesterday
    // when today is 2 Jan, and 1 Jan of next year is tomorrow when today is 31 Dec. The named
    // days take the year rule with them, so the two that cross a year boundary say which one.
    expect(humanDateLabel('2026-01-01', '2026-01-02')).toBe('Yesterday · 1 Jan');
    expect(humanDateLabel('2026-01-01', '2025-12-31')).toBe('Tomorrow · 1 Jan 2026');
    expect(humanDateLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow · 1 Jan 2027');
    expect(humanDateLabel('2026-12-31', '2027-01-01')).toBe('Yesterday · 31 Dec 2026');
  });

  it('does not name a day two away, even across a boundary', () => {
    expect(humanDateLabel('2026-10-03', '2026-10-05')).toBe('3 Oct');
    expect(humanDateLabel('2026-10-07', '2026-10-05')).toBe('7 Oct');
  });

  it('keeps the whole absolute date when the named day is a leap day or near one', () => {
    // A leap day is a date, so it reads as yesterday like any other; the day after a non-leap
    // February is not a date at all and is handed back below.
    expect(humanDateLabel('2024-02-29', '2024-03-01')).toBe('Yesterday · 29 Feb');
    expect(humanDateLabel('2024-03-01', '2024-02-29')).toBe('Tomorrow · 1 Mar');
  });
});

describe('the day and month reading', () => {
  it('reads within the year without one', () => {
    expect(humanDateLabel('2026-01-13', '2026-10-05')).toBe('13 Jan');
    expect(humanDateLabel('2026-12-01', '2026-10-05')).toBe('1 Dec');
  });

  it('adds the year when it is not the current one', () => {
    expect(humanDateLabel('2025-01-13', '2026-10-05')).toBe('13 Jan 2025');
    expect(humanDateLabel('2027-06-30', '2026-10-05')).toBe('30 Jun 2027');
  });

  it('adds the year for a future date a year out on the same month and day', () => {
    // "13 Jan" alone would be a claim about *this* January, so the year is the disambiguator even
    // though the month and day match today's calendar position.
    expect(humanDateLabel('2027-01-13', '2026-01-13')).toBe('13 Jan 2027');
  });
});

describe('a value it cannot read', () => {
  it('falls back to the raw string rather than throwing', () => {
    expect(humanDateLabel('', '2026-10-05')).toBe('');
    expect(humanDateLabel('tomorrow', '2026-10-05')).toBe('tomorrow');
    expect(humanDateLabel('13/01/2026', '2026-10-05')).toBe('13/01/2026');
    expect(humanDateLabel('2026-1-13', '2026-10-05')).toBe('2026-1-13');
  });

  it('refuses a date that is not on the calendar', () => {
    expect(humanDateLabel('2026-02-30', '2026-10-05')).toBe('2026-02-30');
    expect(humanDateLabel('2026-13-01', '2026-10-05')).toBe('2026-13-01');
    expect(humanDateLabel('2026-00-10', '2026-10-05')).toBe('2026-00-10');
    // A leap day is a date; the day after a non-leap February is not. The leap day's own reading
    // is pinned with the other named days above.
    expect(humanDateLabel('2026-02-29', '2026-03-01')).toBe('2026-02-29');
  });

  it('falls back when it is the today argument it cannot read', () => {
    expect(humanDateLabel('2026-10-05', 'not-a-date')).toBe('2026-10-05');
  });
});

describe('the two date ladders', () => {
  it('differ on purpose: the editor preview pairs the word with the day, a ledger row says only the word', () => {
    expect(humanDateLabel('2026-10-06', '2026-10-06')).toBe('Today · 6 Oct');
    expect(formatExpenseDate('2026-10-06', '2026-10-06')).toBe('Today');
  });
});
