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
