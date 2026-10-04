# ADR-0007: Store the split rule with the expense

**Date:** 2026-10-04
**Status:** accepted
**Forced by:** #1

## Decision
Store the split rule beside its result: the split type on Expense, and on each split line the member's input as entered (exact amount, percentage or share count, and whether they were included) beside the computed share. The edit form reopens showing exactly what was entered. Balances and debts read only the stored payer parts and computed shares, never the inputs.

## Why
Reopening an edit form from computed shares alone cannot recover what the user typed: a 33.33% input and an exact-amount input can produce the same stored share, so round-tripping through computed values silently rewrites the user's rule. Storing the inputs makes editing idempotent from the user's perspective — the form reopens showing exactly what was entered — while keeping the money math on one derived path.

## Consequences
Easy: the edit form is a pure function of stored inputs; the record shows the rule, not just its outcome. Hard: two representations of one split must be kept consistent on every write — always in the same transaction as the expense (TR-8) — and validators must check the inputs and the computed shares agree.
