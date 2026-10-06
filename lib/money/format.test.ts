import { describe, expect, it } from 'vitest';
import { percentPartsMessage } from '../expenses/validation';
import { directionWords, formatBasisPoints } from './format';

/**
 * Basis points as the text a person reads (TR-11, AC-6): the rendering half of the percentage
 * boundary, beside `formatMinorUnits`' amounts.
 *
 * It exists because the number it prints is the number in a refusal — "add up to 99.5%, 0.5%
 * short of 100%" — and a message that quotes 99.49999999999999 was never a percentage anybody
 * typed. Integer arithmetic and string assembly is how that stays true; these cases pin whole
 * percentages, hundredths, the trailing zero that would read as a precision claim, and the sign.
 */

describe('formatBasisPoints', () => {
  it('prints a whole percentage with no decimals', () => {
    expect(formatBasisPoints(10000)).toBe('100%');
    expect(formatBasisPoints(5000)).toBe('50%');
    expect(formatBasisPoints(0)).toBe('0%');
  });

  it('prints hundredths, dropping a trailing zero', () => {
    expect(formatBasisPoints(3333)).toBe('33.33%');
    expect(formatBasisPoints(9950)).toBe('99.5%');
    expect(formatBasisPoints(9900)).toBe('99%');
    expect(formatBasisPoints(1230)).toBe('12.3%');
    expect(formatBasisPoints(1)).toBe('0.01%');
    expect(formatBasisPoints(5)).toBe('0.05%');
  });

  it('keeps the sign on a negative gap', () => {
    expect(formatBasisPoints(-50)).toBe('-0.5%');
    expect(formatBasisPoints(-3333)).toBe('-33.33%');
    expect(formatBasisPoints(-10000)).toBe('-100%');
    expect(formatBasisPoints(-1)).toBe('-0.01%');
  });

  it('is the number the shortfall sentence quotes, to the digit', () => {
    // The composition the boundary relies on: percentPartsMessage words its gap through this
    // function, so a change here that stays inside these cases cannot drift from the sentence.
    expect(percentPartsMessage(9950)).toBe('The percentages add up to 99.5%, 0.5% short of 100%.');
    expect(percentPartsMessage(12000)).toBe('The percentages add up to 120%, 20% over 100%.');
    expect(percentPartsMessage(0)).toBe('The percentages add up to 0%, 100% short of 100%.');
  });
});

/**
 * A balance as words plus a colour role (AC-1, AC-6).
 *
 * The words are the part that must never go missing: ui.md's rule is that direction is carried by
 * words *and* colour, so a row that renders only a red number is the failure this pins. The two
 * perspectives are the same three branches — the viewer reading their own row and the viewer
 * reading somebody else's — and zero is neutral on both, because "settled up" is not a debt.
 */
describe('directionWords', () => {
  it('reads a settled balance as neutral, from either side', () => {
    expect(directionWords(0, true)).toEqual({ words: 'All settled up', tone: 'neutral' });
    expect(directionWords(0, false)).toEqual({ words: 'is settled up', tone: 'neutral' });
  });

  it('reads a positive balance as the seat being owed, in the lent colour', () => {
    expect(directionWords(45000, true)).toEqual({ words: 'You are owed', tone: 'lent' });
    expect(directionWords(45000, false)).toEqual({ words: 'is owed', tone: 'lent' });
  });

  it('reads a negative balance as the seat owing, in the owed colour', () => {
    expect(directionWords(-45000, true)).toEqual({ words: 'You owe', tone: 'owed' });
    expect(directionWords(-45000, false)).toEqual({ words: 'owes', tone: 'owed' });
  });

  it('flips only the words when the row is somebody else’s, never the direction', () => {
    // The balance is the seat's, not the reader's: at the same number the tone is the same and
    // only the person changes, which is what keeps one row's number from meaning two things.
    expect(directionWords(-1, false).tone).toBe(directionWords(-1, true).tone);
    expect(directionWords(1, false).tone).toBe(directionWords(1, true).tone);
    expect(directionWords(-1, true).words).not.toBe(directionWords(-1, false).words);
  });

  it('never returns an empty sentence — the words carry the direction on their own', () => {
    for (const balance of [-100, -1, 0, 1, 100]) {
      for (const viewer of [true, false]) {
        expect(directionWords(balance, viewer).words.length).toBeGreaterThan(0);
      }
    }
  });
});
