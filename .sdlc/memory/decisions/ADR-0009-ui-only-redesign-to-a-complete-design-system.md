# ADR-0009: UI-only redesign to a complete design system

**Date:** 2026-10-05
**Status:** accepted
**Forced by:** #31

## Decision
Rewrite docs/ui.md into a complete professional design system for the product issue #31 describes, following the frontend-design and ux skills: the full token set (neutral ramp, surfaces, accent, owed/lent/danger with tints, type scale, extended spacing, radius, elevation), Inter loaded with next/font, lucide-react as the single icon dependency, shared specs for buttons, inputs including money inputs, segmented control, list rows, cards, avatars, badges, dialogs and bottom sheets, toasts, skeletons and empty states, the app shell and navigation, and each screen's structure (landing, auth, home, group page with sections, expense editor, settle-up flow, members and invite, activity, profile) with its states. Behaviour, data and money rules stay exactly as they are.

## Why
Issue #31 found Tabs working but looking like a prototype: no app shell, a text-only landing page with a developer health link, a one-stack group page with the primary action buried, a generic expense form, unstyled browser controls, raw ISO dates and UTC times, zero shown in debt red, and no shared component set. The maintainer's replan decision keeps stack, data model, money rules, TRs and every other decision exactly as they are and asks only for the interface to be redesigned to consumer-fintech standard, decided once in docs/ui.md so every ticket follows it. The frontend-design and ux skills already name the shape: roles not hex values, one type scale, tabular money, direction in words and colour, and every screen's five states.

## Consequences
Easy: every later ticket builds from one token set and one component set, so screens look like one product; QA checks each screen against the same five states. Hard: the rewrite must touch nearly every visible surface at once without changing any behaviour, data shape or money rule, so review must reject any diff that smuggles a behaviour change inside a visual one.
