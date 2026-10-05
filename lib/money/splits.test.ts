import { describe, expect, it } from 'vitest';
import {
  PERCENT_SCALE,
  basisPointsText,
  minorUnitsText,
  parseBasisPoints,
  parseMinorUnits,
  parseShares,
  parseSplitValue,
  shortfallMinor,
  splitAmount,
  splitValueText,
  type SplitInput,
  type SplitType,
} from './splits';

/**
 * The money core, proved without a database, a framework or a form (TR-4).
 *
 * Two properties matter more than any single case, and they are the ones worth stating: every
 * parse of text a person could type gives an integer that means exactly what they typed, and
 * every split of a whole gives parts that add back up to it. The cases below are the edges of
 * those two, plus the remainder — the paisa that has to land somewhere and the spec's answer
 * that it lands on the first payer.
 */

function input(membershipId: string, value: number | null, included = true): SplitInput {
  return { membershipId, included, value };
}

function sum(shares: { shareMinor: number }[]): number {
  return shares.reduce((total, share) => total + share.shareMinor, 0);
}

describe('parseMinorUnits', () => {
  it('turns typed amounts into integers, exactly', () => {
    expect(parseMinorUnits('12.50')).toBe(1250);
    expect(parseMinorUnits('12.5')).toBe(1250);
    expect(parseMinorUnits('12')).toBe(1200);
    expect(parseMinorUnits('0.05')).toBe(5);
    expect(parseMinorUnits('0')).toBe(0);
    expect(parseMinorUnits('  4.20 ')).toBe(420);
  });

  it('does not round through a float', () => {
    // The reason this function exists: 1.15 * 100 is 114.99999999999999, and a ledger that
    // divides by a hundred to convert is a ledger that invents and loses paisa.
    expect(parseMinorUnits('1.15')).toBe(115);
    expect(parseMinorUnits('0.29')).toBe(29);
    expect(parseMinorUnits('8.07')).toBe(807);
    expect(parseMinorUnits('123456.78')).toBe(12345678);
  });

  it('refuses anything it cannot store rather than guessing', () => {
    expect(parseMinorUnits('')).toBeNull();
    expect(parseMinorUnits('  ')).toBeNull();
    expect(parseMinorUnits('abc')).toBeNull();
    expect(parseMinorUnits('-5')).toBeNull();
    expect(parseMinorUnits('1,000')).toBeNull();
    expect(parseMinorUnits('12.505')).toBeNull();
    expect(parseMinorUnits('1e3')).toBeNull();
    expect(parseMinorUnits('₹12')).toBeNull();
  });
});

describe('parseBasisPoints', () => {
  it('reads a percentage as hundredths of a percent', () => {
    expect(parseBasisPoints('33.33')).toBe(3333);
    expect(parseBasisPoints('100')).toBe(PERCENT_SCALE);
    expect(parseBasisPoints('0.01')).toBe(1);
    expect(parseBasisPoints('50.5')).toBe(5050);
    expect(parseBasisPoints('0')).toBe(0);
  });

  it('refuses more than a whole, which is not a percentage', () => {
    expect(parseBasisPoints('100.01')).toBeNull();
    expect(parseBasisPoints('200')).toBeNull();
    expect(parseBasisPoints('abc')).toBeNull();
  });
});

describe('parseShares', () => {
  it('counts whole shares of at least one', () => {
    expect(parseShares('3')).toBe(3);
    expect(parseShares('1')).toBe(1);
    expect(parseShares(' 12 ')).toBe(12);
  });

  it('refuses zero, fractions and negatives', () => {
    expect(parseShares('0')).toBeNull();
    expect(parseShares('1.5')).toBeNull();
    expect(parseShares('-2')).toBeNull();
    expect(parseShares('')).toBeNull();
    expect(parseShares('three')).toBeNull();
  });
});

describe('parseSplitValue', () => {
  it('reads a value in the unit its split type names', () => {
    expect(parseSplitValue('exact', '12.50')).toBe(1250);
    expect(parseSplitValue('percentage', '33.33')).toBe(3333);
    expect(parseSplitValue('shares', '3')).toBe(3);
  });

  it('has no input at all for an equal split', () => {
    expect(parseSplitValue('equal', '12.50')).toBeNull();
    expect(parseSplitValue('equal', '')).toBeNull();
  });
});

describe('text back out', () => {
  it('prints minor units as the amount a field holds', () => {
    expect(minorUnitsText(1250)).toBe('12.50');
    expect(minorUnitsText(5)).toBe('0.05');
    expect(minorUnitsText(0)).toBe('0.00');
    expect(minorUnitsText(12345678)).toBe('123456.78');
  });

  it('prints basis points as the percentage a field holds', () => {
    expect(basisPointsText(3333)).toBe('33.33');
    expect(basisPointsText(10000)).toBe('100');
    expect(basisPointsText(5050)).toBe('50.50');
    expect(basisPointsText(1)).toBe('0.01');
  });

  it('round-trips: what a field shows parses back to what was stored', () => {
    const cases: Array<[SplitType, number]> = [
      ['exact', 1250],
      ['exact', 5],
      ['exact', 0],
      ['percentage', 3333],
      ['percentage', 10000],
      ['percentage', 1],
      ['shares', 1],
      ['shares', 999999],
    ];

    for (const [splitType, value] of cases) {
      expect(parseSplitValue(splitType, splitValueText(splitType, value))).toBe(value);
    }
  });

  it('shows nothing for a type with no input, or a line with no value', () => {
    expect(splitValueText('equal', null)).toBe('');
    expect(splitValueText('exact', null)).toBe('');
    expect(splitValueText('percentage', null)).toBe('');
  });
});

describe('splitAmount', () => {
  it('divides equally and gives the remainder to the first payer', () => {
    const shares = splitAmount(
      1000,
      'equal',
      [input('a', null), input('b', null), input('c', null)],
      ['a'],
    );

    // 333 each, one paisa left over, and it lands on the member the spec names.
    expect(shares).toEqual([
      { membershipId: 'a', shareMinor: 334 },
      { membershipId: 'b', shareMinor: 333 },
      { membershipId: 'c', shareMinor: 333 },
    ]);
    expect(sum(shares)).toBe(1000);
  });

  it('gives the remainder to the first payer even when the split lists somebody first', () => {
    const shares = splitAmount(
      100,
      'equal',
      [input('first', null), input('payer', null), input('third', null)],
      ['payer'],
    );

    expect(shares.find((share) => share.membershipId === 'payer')?.shareMinor).toBe(34);
    expect(sum(shares)).toBe(100);
  });

  it('falls back to the first included member when the payer is not in the split', () => {
    // Legal: a member can pay for an expense they are not part of. Nobody is invented a share
    // for the sake of placing a paisa, so it goes to the first member who is in it.
    const shares = splitAmount(
      100,
      'equal',
      [input('outside', null, false), input('b', null), input('c', null)],
      ['outside'],
    );

    expect(shares).toEqual([
      { membershipId: 'outside', shareMinor: 0 },
      { membershipId: 'b', shareMinor: 50 },
      { membershipId: 'c', shareMinor: 50 },
    ]);
  });

  it('keeps a member left out at zero and does not divide by them', () => {
    const shares = splitAmount(90, 'equal', [input('a', null), input('b', null, false)], ['a']);

    expect(shares).toEqual([
      { membershipId: 'a', shareMinor: 90 },
      { membershipId: 'b', shareMinor: 0 },
    ]);
  });

  it('owes nobody anything when nobody is in the split', () => {
    const shares = splitAmount(500, 'equal', [input('a', null, false)], ['a']);

    expect(shares).toEqual([{ membershipId: 'a', shareMinor: 0 }]);
  });

  it('takes an exact split as typed', () => {
    const shares = splitAmount(
      500,
      'exact',
      [input('a', 300), input('b', 200)],
      ['a'],
    );

    expect(shares).toEqual([
      { membershipId: 'a', shareMinor: 300 },
      { membershipId: 'b', shareMinor: 200 },
    ]);
    expect(sum(shares)).toBe(500);
  });

  it('applies percentages in basis points and places the truncation remainder', () => {
    // 33.33% of 1000 is 333.3, truncated to 333 three times: three paisa of a whole 1000 are
    // left over and go to one stated member, so the parts still make the whole.
    const shares = splitAmount(
      1000,
      'percentage',
      [input('a', 3333), input('b', 3333), input('c', 3333)],
      ['a'],
    );

    expect(shares.map((share) => share.shareMinor)).toEqual([334, 333, 333]);
    expect(sum(shares)).toBe(1000);
  });

  it('does not divide by a zero share count', () => {
    const shares = splitAmount(500, 'shares', [input('a', 0), input('b', 0)], ['a']);

    expect(shares).toEqual([
      { membershipId: 'a', shareMinor: 0 },
      { membershipId: 'b', shareMinor: 0 },
    ]);
  });

  it('splits by shares, in proportion', () => {
    const shares = splitAmount(1000, 'shares', [input('a', 2), input('b', 1)], ['b']);

    // 666 and 333, one paisa left, and the first payer is 'b' — who is in the split, so the
    // remainder follows the payer rather than the row order.
    expect(shares).toEqual([
      { membershipId: 'a', shareMinor: 666 },
      { membershipId: 'b', shareMinor: 334 },
    ]);
    expect(sum(shares)).toBe(1000);
  });

  it('always gives back parts that sum to the whole, whatever the total', () => {
    // Totals chosen for the ways they divide badly: primes, one, and the top of the range.
    const totals = [1, 2, 3, 7, 100, 999, 1000, 12345, 2147483];
    const three = [input('a', null), input('b', null), input('c', null)];

    for (const total of totals) {
      expect(sum(splitAmount(total, 'equal', three, ['a']))).toBe(total);

      // 33.33% twice and 33.34% once is exactly 100%, and still does not divide evenly.
      const percentages = [input('a', 3333), input('b', 3333), input('c', 3334)];
      expect(sum(splitAmount(total, 'percentage', percentages, ['a']))).toBe(total);

      // A share count nothing divides by cleanly.
      const shares = [input('a', 2), input('b', 3), input('c', 5)];
      expect(sum(splitAmount(total, 'shares', shares, ['a']))).toBe(total);

      // An exact split whose parts are computed to add up, in integers, in the test itself.
      const third = Math.floor(total / 3);
      const exact = [input('a', third), input('b', third), input('c', total - 2 * third)];
      expect(sum(splitAmount(total, 'exact', exact, ['a']))).toBe(total);
    }
  });

  it('keeps its exactness at the top of the storable range', () => {
    const total = 2147483647;
    const shares = splitAmount(
      total,
      'percentage',
      [input('a', PERCENT_SCALE)],
      ['a'],
    );

    expect(shares).toEqual([{ membershipId: 'a', shareMinor: total }]);
  });
});

describe('shortfallMinor', () => {
  it('is positive when the parts are short, negative when over, zero when level', () => {
    expect(shortfallMinor(500, [300, 150])).toBe(50);
    expect(shortfallMinor(500, [300, 250])).toBe(-50);
    expect(shortfallMinor(500, [300, 200])).toBe(0);
    expect(shortfallMinor(500, [])).toBe(500);
  });
});
