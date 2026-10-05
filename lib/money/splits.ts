/**
 * The money core (TR-4). Every split type in one place, as integer arithmetic on minor units,
 * plus the two directions of the boundary: what a person types in, and what a form shows them
 * back.
 *
 * Three rules hold for everything in this file, and they are the reason it has no database, no
 * framework and no clock in it:
 *
 * - **Nothing here is a float.** An amount crosses in as `parseMinorUnits`' integer and leaves
 *   as one; the only division is integer division, and the remainder is placed rather than
 *   rounded away. `parseFloat('1.15') * 100` is 114.99999999999999, which is how a ledger
 *   invents a paisa nobody paid.
 * - **The parts always sum to the whole.** `splitAmount` assigns the remainder explicitly, so
 *   its output sums to the total for every input a caller can hand it — including a caller that
 *   skipped the boundary, which is what makes "never half-written money" true one layer below
 *   the transaction as well.
 * - **The remainder goes to a stated member.** Per the spec, the first payer; where the first
 *   payer is not part of the split — legal, since members can be left out — the first member
 *   who is, because the alternative is inventing a share for somebody the group decided is not
 *   in this expense. In the ordinary case the payer is the first person in the split and the
 *   two readings are the same member.
 */

/** The closed set from the spec. Stored as text so widening it is data, not a migration. */
export const SPLIT_TYPES = ['equal', 'exact', 'percentage', 'shares'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];
export const DEFAULT_SPLIT_TYPE: SplitType = 'equal';

/**
 * Percentages are basis points — hundredths of a percent — so 33.33% is the integer 3333 and
 * 100% is 10000. Integers all the way down is the only way a percentage can be exact.
 */
export const PERCENT_SCALE = 10_000;

/** How many minor units make one whole unit. Two, for every currency this product stores. */
export const MINOR_UNITS_PER_UNIT = 100;

/**
 * The largest amount the ledger can hold, in minor units: the ceiling of the `integer` columns
 * every amount, part and share lands in. The boundary refuses anything above it rather than
 * letting the database reject it, because "value out of range for type integer" is a 500 and
 * "enter an amount no more than this" is an answer.
 */
export const MAX_MINOR_UNITS = 2_147_483_647;

/**
 * A typed amount with at most two decimal places and a bounded whole part, so `Number` stays
 * exact and a paste of a hundred digits is refused rather than stored.
 */
const DECIMAL = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** A typed share count: a positive whole number, bounded for the same reason. */
const SHARE_COUNT = /^\d{1,6}$/;

/**
 * A typed amount as integer minor units ("12.50" is 1250), or null when it is not something
 * this product will store. String arithmetic, never `parseFloat` — see the file comment.
 */
export function parseMinorUnits(raw: string): number | null {
  const match = DECIMAL.exec(raw.trim());
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * MINOR_UNITS_PER_UNIT + fraction;
}

/** A typed percentage as basis points ("33.33" is 3333). More than 100% is not a percentage. */
export function parseBasisPoints(raw: string): number | null {
  const match = DECIMAL.exec(raw.trim());
  if (!match) return null;

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * MINOR_UNITS_PER_UNIT + fraction;
  return basisPoints <= PERCENT_SCALE ? basisPoints : null;
}

/** A typed share count ("3" is 3). Shares are counted, not measured, so they are whole. */
export function parseShares(raw: string): number | null {
  const value = raw.trim();
  if (!SHARE_COUNT.test(value)) return null;

  const shares = Number(value);
  return shares >= 1 ? shares : null;
}

/**
 * A typed value in the unit its split type names, or null when it is not one. The one place
 * that decides what "the input" means for each type, so the boundary that validates it and the
 * editor that reopens it cannot disagree about what a stored number is.
 */
export function parseSplitValue(splitType: SplitType, raw: string): number | null {
  if (splitType === 'equal') return null;
  if (splitType === 'exact') return parseMinorUnits(raw);
  if (splitType === 'percentage') return parseBasisPoints(raw);
  return parseShares(raw);
}

/**
 * Minor units back as the text a form field holds ("12.50"), the exact inverse of
 * `parseMinorUnits`. Reopening an expense puts the stored amount back into the input it came
 * from, so it is one function rather than a `toFixed` that would print 12.5 and 12.50 for the
 * same number depending on who typed it.
 */
export function minorUnitsText(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / MINOR_UNITS_PER_UNIT);
  const fraction = Math.abs(amountMinor % MINOR_UNITS_PER_UNIT);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Basis points back as the text a percentage field holds ("33.33", "100"). The inverse of
 * `parseBasisPoints`, and integer arithmetic for the same reason as `minorUnitsText` — a
 * percentage that reopens as 33.329999999999998 was never the number anybody typed.
 */
export function basisPointsText(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / MINOR_UNITS_PER_UNIT);
  const fraction = Math.abs(basisPoints % MINOR_UNITS_PER_UNIT);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * A stored input back as the text its field holds, in the unit the expense's split type names —
 * `minorUnitsText` for an exact amount, `basisPointsText` for a percentage, the plain count for
 * shares, and nothing at all for an equal split, which stores no input. The inverse of
 * `parseSplitValue`, beside it, so the editor that reopens an expense and the boundary that
 * accepted it cannot disagree about which number means what.
 */
export function splitValueText(splitType: SplitType, value: number | null): string {
  if (value === null || splitType === 'equal') return '';
  if (splitType === 'exact') return minorUnitsText(value);
  if (splitType === 'shares') return String(value);
  return basisPointsText(value);
}

/** One member's say in a split: whether they are in it, and what they typed if the type wants it. */
export interface SplitInput {
  membershipId: string;
  included: boolean;
  /** Minor units for exact, basis points for percentage, a count for shares; null for equal. */
  value: number | null;
}

/** What one member owes of the whole, in minor units. */
export interface SplitShare {
  membershipId: string;
  shareMinor: number;
}

/** Exact integer division of a non-negative numerator, whatever its magnitude. */
function floorDivide(numerator: number, denominator: number): number {
  // BigInt rather than `Math.floor(a / b)` because the numerator of a percentage share is
  // total × basis points: at the top of the amount range that product passes the point where a
  // double still counts one at a time, and the paisa it loses would land in somebody's balance.
  return Number(BigInt(numerator) / BigInt(denominator));
}

/**
 * Who takes the rounding remainder. The first payer who is in the split, so the amount lands on
 * the member the spec names; when the payer is not in it, the first member who is. Only ever
 * asked about a non-empty set of included members — the caller checks that first.
 */
function remainderRecipient(
  included: readonly SplitInput[],
  payerOrder: readonly string[],
): string {
  const recipient = payerOrder.find((payer) =>
    included.some((line) => line.membershipId === payer),
  );
  return recipient ?? included[0].membershipId;
}

/**
 * Every member's share of `totalMinor`, by `type`.
 *
 * The inputs are the members as the editor offered them, in submission order, with the ones
 * left out marked rather than absent — the output carries a share for every one of them, zero
 * for anyone not included, because that is the row the expense stores. `payerOrder` is who paid,
 * in the order they were submitted, and decides only who absorbs the remainder.
 *
 * A member left out of the split gets nothing, and no remainder is invented for them. Nothing
 * here validates: the caller has already proved the inputs add up (exact) or are a whole
 * percentage (percentage) or a positive count (shares). The one thing it does guarantee on its
 * own is sum preservation, so a caller that skipped the boundary still writes parts that sum to
 * the whole rather than money that quietly vanishes.
 */
export function splitAmount(
  totalMinor: number,
  type: SplitType,
  inputs: readonly SplitInput[],
  payerOrder: readonly string[] = [],
): SplitShare[] {
  const included = inputs.filter((input) => input.included);

  // No participants is a state the boundary refuses; returning nothing owed rather than
  // dividing by zero keeps a bypassed caller from writing Infinity into somebody's balance.
  if (included.length === 0) {
    return inputs.map((input) => ({ membershipId: input.membershipId, shareMinor: 0 }));
  }

  const shareOf = new Map<string, number>();

  if (type === 'equal') {
    const base = Math.floor(totalMinor / included.length);
    for (const input of included) shareOf.set(input.membershipId, base);
  } else if (type === 'exact') {
    for (const input of included) shareOf.set(input.membershipId, input.value ?? 0);
  } else if (type === 'percentage') {
    for (const input of included) {
      shareOf.set(input.membershipId, floorDivide(totalMinor * (input.value ?? 0), PERCENT_SCALE));
    }
  } else {
    const totalShares = included.reduce((sum, input) => sum + (input.value ?? 0), 0);
    if (totalShares <= 0) {
      return inputs.map((input) => ({ membershipId: input.membershipId, shareMinor: 0 }));
    }
    for (const input of included) {
      shareOf.set(
        input.membershipId,
        floorDivide(totalMinor * (input.value ?? 0), totalShares),
      );
    }
  }

  // Truncating each share leaves the whole short by at most one minor unit per member, and the
  // spec's answer is to give the lot to one stated member rather than spread it.
  const assigned = included.reduce((sum, input) => sum + (shareOf.get(input.membershipId) ?? 0), 0);
  const remainder = totalMinor - assigned;
  if (remainder !== 0) {
    const recipient = remainderRecipient(included, payerOrder);
    shareOf.set(recipient, (shareOf.get(recipient) ?? 0) + remainder);
  }

  return inputs.map((input) => ({
    membershipId: input.membershipId,
    shareMinor: shareOf.get(input.membershipId) ?? 0,
  }));
}

/**
 * How far a set of parts misses its whole: positive when they are short of it, negative when
 * they are over, zero when they balance. The one arithmetic the boundary needs to say "50 short
 * of 500" without doing the subtraction itself in two places and wording it differently in each.
 */
export function shortfallMinor(totalMinor: number, partsMinor: readonly number[]): number {
  return totalMinor - partsMinor.reduce((sum, part) => sum + part, 0);
}
