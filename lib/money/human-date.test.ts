import { describe, expect, it } from 'vitest';
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
 */

describe('the three named days', () => {
  it('names today, yesterday and tomorrow', () => {
    expect(humanDateLabel('2026-10-05', '2026-10-05')).toBe('Today');
    expect(humanDateLabel('2026-10-04', '2026-10-05')).toBe('Yesterday');
    expect(humanDateLabel('2026-10-06', '2026-10-05')).toBe('Tomorrow');
  });

  it('crosses a month boundary and a year boundary in both directions', () => {
    // The edge a string comparison or a "same month" shortcut would get wrong: 1 Jan is yesterday
    // when today is 2 Jan, and 1 Jan of next year is tomorrow when today is 31 Dec.
    expect(humanDateLabel('2026-01-01', '2026-01-02')).toBe('Yesterday');
    expect(humanDateLabel('2026-01-01', '2025-12-31')).toBe('Tomorrow');
    expect(humanDateLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow');
    expect(humanDateLabel('2026-12-31', '2027-01-01')).toBe('Yesterday');
  });

  it('does not name a day two away, even across a boundary', () => {
    expect(humanDateLabel('2026-10-03', '2026-10-05')).toBe('3 Oct');
    expect(humanDateLabel('2026-10-07', '2026-10-05')).toBe('7 Oct');
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
    // A leap day is a date; the day after a non-leap February is not.
    expect(humanDateLabel('2024-02-29', '2024-03-01')).toBe('Yesterday');
    expect(humanDateLabel('2026-02-29', '2026-03-01')).toBe('2026-02-29');
  });

  it('falls back when it is the today argument it cannot read', () => {
    expect(humanDateLabel('2026-10-05', 'not-a-date')).toBe('2026-10-05');
  });
});
