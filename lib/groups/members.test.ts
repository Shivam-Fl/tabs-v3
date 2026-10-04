import { describe, expect, it } from 'vitest';
import { NonZeroBalanceError, assertZeroBalance, getMemberBalance } from './members';

/**
 * The removal rule, proved without a database. Every membership is zero until TR-9 lands the
 * ledger, so the seam's answer today is asserted here too — the day it stops being zero, this
 * is the test that has to be changed on purpose rather than the guard quietly ceasing to fire.
 */
describe('assertZeroBalance', () => {
  it('passes a settled membership through', () => {
    expect(() => assertZeroBalance(0, 'Bo')).not.toThrow();
  });

  it('throws for a membership whose balance is not zero, pointing at settle-up', () => {
    expect(() => assertZeroBalance(500, 'Bo')).toThrow(NonZeroBalanceError);

    try {
      assertZeroBalance(500, 'Bo');
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NonZeroBalanceError);
      if (!(error instanceof NonZeroBalanceError)) return;

      expect(error.message).toContain('Bo');
      expect(error.message).toMatch(/settle up/i);
      expect(error.displayName).toBe('Bo');
      expect(error.balanceMinor).toBe(500);
    }
  });

  it('treats a negative balance as unsettled too — owing the group is not settled', () => {
    expect(() => assertZeroBalance(-1, 'Bo')).toThrow(NonZeroBalanceError);
  });
});

describe('getMemberBalance', () => {
  it('is zero for every membership until the ledger exists', () => {
    expect(getMemberBalance('6f0a2b1c-3d4e-4f50-8a9b-0c1d2e3f4a5b', 'ignored')).toBe(0);
  });
});
