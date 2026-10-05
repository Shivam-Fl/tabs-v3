---
name: frontend-design
description: How Tabs looks — the visual system (type scale, colour ramp, spacing, elevation, radius), the component patterns, and the craft checks that make a screen look like a shipped product instead of a prototype. Load it before designing, building or reviewing any screen or component.
---

# Frontend design for Tabs

Tabs is a money app people open on their phone in a restaurant and on a laptop at home. It has to
look calm, exact and trustworthy: the numbers are the product. Every screen should look like it
belongs to the same shipped app — the bar is a polished consumer fintech app, not an admin panel
and not a tutorial project.

`docs/ui.md` is the design system's source of truth. This skill is how to apply it well. Where
`docs/ui.md` names a value, use it; where it is silent, use the defaults below, and keep them
consistent across every screen.

## The look in one paragraph

Light neutral page, white surfaces with a 1px hairline border and the softest shadow, generous
whitespace, one accent colour used sparingly for the primary action and focus, strong type
hierarchy carried by size and weight rather than colour, money in tabular figures, and direction
(owe vs owed) shown by colour **and** words. Nothing default-browser: every control is styled.

## Type

- Load the body font with `next/font` (no flash, no layout shift); fall back to the system stack.
- One scale, used everywhere (size / line-height): `12/16` caption, `14/20` secondary, `16/24` body,
  `18/28` lead, `20/28` section title, `24/32` page title, `30/36` hero number. Nothing in between.
- Weights: 400 body, 500 labels and buttons, 600 headings and amounts. Never 300 for text.
- Page title: one `h1` per page at 24/32 semibold. Section titles `h2` at 20/28. Eyebrow labels at
  12/16, uppercase only with `tracking-wide` and muted colour.
- Money: `font-variant-numeric: tabular-nums` always; the key balance on a screen is the largest
  text on it (30/36 semibold). Currency symbol the same size as the number, never superscript.
- Line length 60–75 characters for any paragraph; truncate long names with an ellipsis and a
  `title`, never let them wrap a row into three lines.

## Colour

Work from roles, not hex values. Build a neutral ramp from the ink and background tokens:

| role | use |
|---|---|
| ink (900) | primary text, amounts |
| ink-muted (600) | secondary text, metadata — must still meet 4.5:1 on its surface |
| ink-subtle (400) | placeholders, disabled text, icons at rest |
| border (200) | hairline borders, dividers |
| surface-sunken (50–100) | page background, table stripes, input fill |
| surface | cards, sheets, dialogs |
| accent | primary button, links, focus ring, selected tab — and almost nothing else |
| owed / lent | debt and credit amounts, always paired with words ("you owe", "owes you") |
| danger | destructive actions and errors only |

- Tints for status backgrounds (e.g. a settled banner) are the role colour at 8–12% opacity with
  the full colour for text/icon.
- Never convey state by colour alone. Never put muted grey text on a tinted background without
  checking contrast.

## Space, layout, shape

- Spacing comes only from the scale in `docs/ui.md`. Inside a component use the small steps; between
  sections use the largest. Consistent vertical rhythm matters more than any single value.
- Page shell: a slim top bar (app name/home, current group, account menu), content in a centred
  column — 640px for forms and detail pages, up to 1024px for lists with a side panel on desktop.
  On phones the column is full-width with a 16px gutter.
- Group detail on desktop: balances summary in a side card, the expense list in the main column.
  On phones: summary card first, then the list, primary action reachable by the thumb.
- Radius: one value for cards, inputs and buttons (`docs/ui.md`), fully rounded for avatars and pills.
- Elevation: cards get a hairline border plus `shadow-sm`; menus, dialogs and toasts get a stronger
  shadow. Nothing else floats.

## Components (build each once, in the shared UI module, and reuse)

- **Button**: primary (accent fill), secondary (surface + border), ghost (text only), destructive
  (danger). Sizes 36px and 44px tall. Every button has hover, `focus-visible` ring, active, disabled
  and pending (spinner or "Saving…" + disabled) states. Label is a verb: "Add expense", "Settle up".
- **Input / select / textarea**: visible label above, optional hint below, error below in danger
  colour with an icon. 44px tall on touch, sunken fill or white with border, accent ring on focus.
  Money inputs: right-aligned tabular figures, currency prefix inside the field, `inputmode="decimal"`.
- **Segmented control / tabs**: for split type and feed filters; clear selected state, keyboard
  arrows move between options.
- **List row**: avatar or icon on the left, title + metadata stacked in the middle, amount right-aligned
  and coloured by direction, whole row is the hit target with a hover/pressed background.
- **Card**: surface, border, `shadow-sm`, padded from the scale, optional header with title + action.
- **Avatar**: initials on a stable colour derived from the member id, 32px in rows, 40px in headers.
- **Badge/pill**: small 12px text for states (Settled, Placeholder, Archived, You).
- **Empty state**: a simple illustration or icon, one sentence on what goes here, the primary action.
- **Skeleton**: grey blocks shaped like the real content; never a page-wide spinner.
- **Dialog / sheet**: centred dialog on desktop, bottom sheet on phones; focus trapped and returned.
- **Toast**: bottom-centre on phones, bottom-right on desktop, auto-dismiss, `aria-live="polite"`.

Icons: one set, one stroke width, 16px inline and 20px in buttons, always `aria-hidden` next to text.
If the project has not adopted an icon set, propose one in the work order rather than mixing glyphs
or using emoji as icons.

## Craft checklist — run it before calling a screen done

1. Screenshot at 375×812 and 1280×800 (Playwright). Compare with the other screens: same header,
   same spacing rhythm, same buttons, same type sizes.
2. Every interactive element: hover, focus-visible, active, disabled, pending — all visible.
3. Every data screen: empty, loading (skeleton), error (message + retry), one item, many items,
   a very long name, a very large amount.
4. Nothing unstyled: no default checkboxes, radios, selects, date inputs or file inputs left as the
   browser draws them.
5. No horizontal scroll on phones; no text below 12px; touch targets at least 44px.
6. Amounts: tabular, right-aligned in lists, direction in colour and words, the group currency.
7. Contrast: body and muted text 4.5:1, large text and icons 3:1.

## What makes it look amateur — avoid

Default browser controls; everything centred; random margins; grey-on-grey low-contrast text;
three accent colours; bold everywhere; walls of form fields with no grouping; tables that overflow
on phones; raw numbers without currency; emoji as icons; spinners replacing whole pages; layout
that jumps when data loads; inconsistent button styles between screens.
