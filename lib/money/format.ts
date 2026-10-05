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
