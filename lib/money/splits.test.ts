import { describe, expect, it } from 'vitest';
import {
  MAX_MINOR_UNITS,
  PERCENT_SCALE,
  SPLIT_TYPES,
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
  type SplitShare,
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

/**
 * The same two properties, over inputs nobody chose (AC-7).
 *
 * The cases above prove the rule at the edges a person thought of. TR-4 is a claim about every
 * split the boundary can produce, and the totals that divide badly are not only the round ones —
 * so this sweeps totals drawn across the whole storable range, one to six members, and values
 * that are valid for the type. `Math.random` would make a failure unreproducible, so the draws
 * come from a seeded PRNG: a red test here names the seed and the iteration to look at.
 */

/** A generated expense: a total, the members as the editor would submit them, and who paid. */
interface GeneratedSplit {
  total: number;
  inputs: SplitInput[];
  payerOrder: string[];
}

/** A tiny deterministic PRNG (mulberry32), so a failure is reproducible from its seed alone. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [min, max], inclusive. */
function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * One case, built the way the boundary would have built it: a total inside the amount range, one
 * to six members of whom at least one is in the split, and values that are valid for the type —
 * exact parts that add up, basis points that make a whole hundred, share counts of at least one.
 * Some members pay and some are left out, because both decide where a remainder lands.
 */
function generatedSplit(type: SplitType, random: () => number): GeneratedSplit {
  const total = randomInt(random, 1, MAX_MINOR_UNITS);
  const members = Array.from({ length: randomInt(random, 1, 6) }, (_, index) => `member-${index}`);

  const included = members.map(() => random() < 0.75);
  if (!included.some(Boolean)) included[0] = true;
  const inSplit = included.flatMap((memberIsIn, index) => (memberIsIn ? [index] : []));

  const values = members.map((): number | null => null);
  if (type === 'exact' || type === 'percentage') {
    // Exact parts and basis points both have to add up to a stated whole, so the last member in
    // the split takes what is left rather than the generator inventing a total.
    const whole = type === 'exact' ? total : PERCENT_SCALE;
    let left = whole;
    inSplit.forEach((index, position) => {
      values[index] = position === inSplit.length - 1 ? left : randomInt(random, 0, left);
      left -= values[index] ?? 0;
    });
  } else if (type === 'shares') {
    for (const index of inSplit) values[index] = randomInt(random, 1, 999999);
  }

  // A payer who is not in the split is legal, and is the one case where the remainder falls to
  // somebody other than the first payer.
  const payerOrder = members.filter(() => random() < 0.6);
  if (payerOrder.length === 0) payerOrder.push(members[randomInt(random, 0, members.length - 1)]);

  return {
    total,
    inputs: members.map((membershipId, index) => ({
      membershipId,
      included: included[index],
      value: values[index],
    })),
    payerOrder,
  };
}

/**
 * The spec's answer, computed here independently of the implementation: every part is its share
 * of the whole truncated towards zero, and whatever the truncation leaves over goes to one member
 * — the first payer who is in the split, or the first member who is when the payer is not. The
 * truncation is done in BigInt so this is exact for every generated magnitude, which is the point
 * of checking it rather than trusting the arithmetic beside it.
 */
function specShares(
  generated: GeneratedSplit,
  type: SplitType,
): { shares: SplitShare[]; remainder: number } {
  const { total, inputs, payerOrder } = generated;
  const included = inputs.filter((input) => input.included);
  const shareOf = new Map<string, number>();

  if (type === 'equal') {
    const base = Math.floor(total / included.length);
    for (const input of included) shareOf.set(input.membershipId, base);
  } else {
    const denominator =
      type === 'exact'
        ? null
        : type === 'percentage'
          ? PERCENT_SCALE
          : included.reduce((sum, input) => sum + (input.value ?? 0), 0);
    for (const input of included) {
      shareOf.set(
        input.membershipId,
        denominator === null
          ? (input.value ?? 0)
          : Number((BigInt(total) * BigInt(input.value ?? 0)) / BigInt(denominator)),
      );
    }
  }

  const assigned = included.reduce((sum, input) => sum + (shareOf.get(input.membershipId) ?? 0), 0);
  const remainder = total - assigned;
  if (remainder !== 0) {
    const recipient =
      payerOrder.find((payer) => included.some((input) => input.membershipId === payer)) ??
      included[0].membershipId;
    shareOf.set(recipient, (shareOf.get(recipient) ?? 0) + remainder);
  }

  return {
    shares: inputs.map((input) => ({
      membershipId: input.membershipId,
      shareMinor: shareOf.get(input.membershipId) ?? 0,
    })),
    remainder,
  };
}

/** Four types × this many iterations, from one seed — the corpus every case below draws from. */
const SWEEP_ITERATIONS = 200;
const SWEEP_SEED = 0x5eed;

function sweep(
  check: (generated: GeneratedSplit, type: SplitType, shares: SplitShare[]) => void,
): void {
  const random = seededRandom(SWEEP_SEED);

  for (let iteration = 0; iteration < SWEEP_ITERATIONS; iteration++) {
    for (const type of SPLIT_TYPES) {
      const generated = generatedSplit(type, random);
      check(
        generated,
        type,
        splitAmount(generated.total, type, generated.inputs, generated.payerOrder),
      );
    }
  }
}

describe('splitAmount, over generated inputs', () => {
  it('gives back parts that sum to the whole, whatever the total and the members', () => {
    sweep((generated, _type, shares) => {
      expect(sum(shares)).toBe(generated.total);
    });
  });

  it('puts the truncation remainder on the first payer in the split, else the first included member', () => {
    let placed = 0;

    sweep((generated, type, shares) => {
      const expected = specShares(generated, type);
      expect(shares).toEqual(expected.shares);
      if (expected.remainder !== 0) placed += 1;
    });

    // A corpus that never had a remainder to place would prove nothing about where one goes.
    expect(placed).toBeGreaterThan(0);
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
