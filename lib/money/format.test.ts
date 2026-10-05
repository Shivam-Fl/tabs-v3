import { describe, expect, it } from 'vitest';
import { percentPartsMessage } from '../expenses/validation';
import { formatBasisPoints } from './format';

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
