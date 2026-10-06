import { describe, expect, it } from 'vitest';
import {
  formatExpenseDate,
  formatViewerTimestamp,
  formatZoneNeutralDate,
  localDay,
} from './dates';

/**
 * The date presenters, on their own. Every case hands in the day or the instant to judge
 * against, which is the property the module exists for: nothing below would change if the
 * machine running it were in another zone, or on another day.
 *
 * 2026-10-06 is a Tuesday, so the week around it has a name for each rung of the ladder.
 */

const TODAY = '2026-10-06';

describe('formatExpenseDate', () => {
  it('says Today and Yesterday against the day it is given, not against a clock', () => {
    expect(formatExpenseDate(TODAY, TODAY)).toBe('Today');
    expect(formatExpenseDate('2026-10-05', TODAY)).toBe('Yesterday');
  });

  it('names the weekday for the rest of the last seven days', () => {
    expect(formatExpenseDate('2026-10-04', TODAY)).toBe('Sun');
    expect(formatExpenseDate('2026-10-01', TODAY)).toBe('Thu');
    expect(formatExpenseDate('2026-09-30', TODAY)).toBe('Wed');
  });

  it('drops the year inside the current one and keeps it otherwise', () => {
    // Seven days back is where the weekday ladder ends, so the day just past it is a date.
    // September is the one month en-GB abbreviates to four letters; pinning it here keeps the
    // day the abbreviation comes from CLDR rather than from a table this file invented.
    expect(formatExpenseDate('2026-09-29', TODAY)).toBe('29 Sept');
    expect(formatExpenseDate('2026-01-13', TODAY)).toBe('13 Jan');
    expect(formatExpenseDate('2025-10-03', TODAY)).toBe('3 Oct 2025');
  });

  it('falls back to the string it was handed when that is not a date', () => {
    expect(formatExpenseDate('not a date', TODAY)).toBe('not a date');
    expect(formatExpenseDate('2026-02-31', TODAY)).toBe('2026-02-31');
    expect(formatExpenseDate('', TODAY)).toBe('');
  });

  it('still prints the date when the day to compare against is unusable', () => {
    // No relative label is possible, so the absolute one has to carry the whole answer.
    expect(formatExpenseDate(TODAY, 'not a date')).toBe('6 Oct 2026');
  });

  it('does not call a future date Today or Yesterday', () => {
    expect(formatExpenseDate('2026-10-07', TODAY)).toBe('7 Oct');
    expect(formatExpenseDate('2027-10-06', TODAY)).toBe('6 Oct 2027');
  });
});

describe('formatViewerTimestamp', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');

  it('buckets a recent instant as just now, minutes, hours and days', () => {
    expect(formatViewerTimestamp('2026-10-06T11:59:30.000Z', now)).toBe('Just now');
    expect(formatViewerTimestamp('2026-10-06T12:00:00.000Z', now)).toBe('Just now');
    expect(formatViewerTimestamp('2026-10-06T11:59:00.000Z', now)).toBe('1 minute ago');
    expect(formatViewerTimestamp('2026-10-06T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(formatViewerTimestamp('2026-10-06T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(formatViewerTimestamp('2026-10-04T12:00:00.000Z', now)).toBe('2 days ago');
  });

  it('reads a future instant as just now rather than as a negative age', () => {
    expect(formatViewerTimestamp('2026-10-06T12:00:30.000Z', now)).toBe('Just now');
  });

  it('prints the moment itself past a week, in the viewer zone and with no zone label', () => {
    const text = formatViewerTimestamp('2025-10-03T14:30:00.000Z', now);
    expect(text).toMatch(/Oct 2025/);
    expect(text).not.toMatch(/UTC|GMT/);
  });

  it('hands back the raw string when it is not an instant', () => {
    expect(formatViewerTimestamp('not a timestamp', now)).toBe('not a timestamp');
    expect(formatViewerTimestamp('', now)).toBe('');
  });
});

describe('formatZoneNeutralDate', () => {
  it('reads a calendar date and the day of an instant without consulting a clock', () => {
    expect(formatZoneNeutralDate('2026-10-06')).toBe('6 Oct 2026');
    // The head of an instant is its UTC day, so the same moment is the same string everywhere.
    expect(formatZoneNeutralDate('2026-10-06T23:30:00.000Z')).toBe('6 Oct 2026');
    expect(formatZoneNeutralDate('2026-10-06T00:30:00.000Z')).toBe('6 Oct 2026');
  });

  it('carries no zone label, because it makes no claim about one', () => {
    expect(formatZoneNeutralDate('2026-10-06T12:00:00.000Z')).not.toMatch(/UTC|GMT/);
  });

  it('hands back an unreadable string unchanged', () => {
    expect(formatZoneNeutralDate('rubbish')).toBe('rubbish');
    expect(formatZoneNeutralDate('2026-02-31')).toBe('2026-02-31');
  });
});

describe('localDay', () => {
  it('reads the day off the clock it is handed, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 3, 23, 30))).toBe('2026-01-03');
    expect(localDay(new Date(2026, 9, 6, 0, 1))).toBe('2026-10-06');
  });
});
