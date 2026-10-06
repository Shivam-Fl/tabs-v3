/**
 * How an amount becomes text (TR-11). Money lives as integer minor units everywhere and turns
 * into a string exactly here, at render time, in the currency the group holds — which is the
 * only place a division by a hundred is allowed to happen, and the only place a float exists
 * for as long as it takes Intl to print it.
 *
 * The ledger that puts real amounts behind this arrives with TR-8 and TR-9; the screens built
 * now already render their balances through it, so the formatting is not the thing that changes
 * when the numbers do.
 */
export function formatMinorUnits(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
}

/** The tone a balance reads in — ui.md's colour role, never the only carrier of the direction. */
export type BalanceTone = 'neutral' | 'lent' | 'owed';

export interface DirectionWords {
  /** How the balance reads, in words. Always present: direction is never colour alone (AC-6). */
  words: string;
  /** Which colour role the words and the amount wear. `neutral` is the settled state. */
  tone: BalanceTone;
}

/**
 * A balance as the sentence and the colour a row shows it in (AC-1, AC-6).
 *
 * Positive is what the group owes the seat, so the seat is **owed** — read from the viewer's
 * side when the row is the viewer's own, and in the third person otherwise. Zero is neutral
 * wherever it appears: ui.md forbids a red zero, because "settled up" is not a debt.
 *
 * The two perspectives are one function rather than two spellings of the same three branches,
 * which is what keeps the home screen, the group page and the members roster from drifting into
 * three opinions about which way a number points.
 */
export function directionWords(balanceMinor: number, viewerIsSubject: boolean): DirectionWords {
  if (balanceMinor === 0) {
    return { words: viewerIsSubject ? 'All settled up' : 'is settled up', tone: 'neutral' };
  }
  if (balanceMinor > 0) {
    return { words: viewerIsSubject ? 'You are owed' : 'is owed', tone: 'lent' };
  }
  return { words: viewerIsSubject ? 'You owe' : 'owes', tone: 'owed' };
}

/**
 * Basis points as the percentage a person typed (3333 -> "33.33%", 9950 -> "99.5%", 10000 ->
 * "100%"), for the sentence that names a percentage split's shortfall.
 *
 * Written as integer arithmetic and string assembly rather than a division, for the reason the
 * comment above gives: `3333 / 100` prints 33.33 going on to seventeen digits on the way to a
 * screen, and an error message that quotes a number nobody typed is worse than no message.
 * Trailing zeroes are dropped so 0.5% reads as a percentage rather than as a precision claim.
 */
export function formatBasisPoints(basisPoints: number): string {
  const sign = basisPoints < 0 ? '-' : '';
  const magnitude = Math.abs(basisPoints);
  const whole = Math.trunc(magnitude / 100);
  const fraction = magnitude % 100;
  const decimals = fraction === 0 ? '' : `.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;

  return `${sign}${whole}${decimals}%`;
}
