# ADR-0005: Greedy min-cash-flow debt simplification

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Simplify debts with greedy min-cash-flow on net balances (max debtor vs max creditor), guaranteeing at most N-1 transfers; document the algorithm and this guarantee in code and UI.

## Why
The spec demands the simplification algorithm be stated with its guarantees. True minimum-transfer settlement is NP-complete (subset-sum), so the honest choice is the standard greedy min-cash-flow over net balances: settle max debtor against max creditor until empty. It guarantees at most N-1 transfers and no cycles, which is what Splitwise-class apps ship; claiming absolute minimality would be false.

## Consequences
Easy: O(E + N log N), trivially testable, explainable in UI copy. Hard: rare cases exist where one fewer transfer is theoretically possible; support copy must say fewest-achieved-by-algorithm, never optimal.
