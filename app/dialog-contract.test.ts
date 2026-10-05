import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Dialog, MENU_ITEM_CLASSES, MenuPanel, menuKeyIntent, stepMenuItem } from '../components/ui-interactive';

/**
 * The static contract of the two controls this piece introduces into production for the first
 * time: the dialog every destructive confirm now opens in (AC-7) and the menu the row actions
 * share with the shell (AC-7).
 *
 * It is a *static* contract on purpose. The repo runs vitest in node with no jsdom, so focus
 * trapping, focus return and Escape-closes are browser facts, and this file does not pretend
 * otherwise — `residual_risks` says so and the QA script proves them at both viewports. What a
 * cold render *can* pin is the shape those behaviours hang off: that a dialog is a labelled modal
 * with the right position for its variant, that closed renders nothing at all (which is what makes
 * every dialog in this app invisible to a cold page load, and what keeps the debts card at exactly
 * one live region), and that the menu's arithmetic wraps and jumps where it says it does.
 *
 * It lives under `app/` rather than beside the components because `vitest.config.ts` collects
 * `lib/**`, `app/**` and `scripts/**` only — a `components/dialog-contract.test.ts` would be
 * collected by nothing and would prove nothing, exactly as the sibling `app/ui-set.test.ts` and
 * `app/app-shell.test.ts` already document for the components they cover.
 *
 * One deliberate difference from the plan's wording: it asked for "aria-modal and labelledby". The
 * shipped Dialog names itself with `aria-label` (its title doubles as the heading inside it), and
 * this piece may not change that API, so the name is asserted where it actually is.
 */

function dialog(open: boolean, variant?: 'dialog' | 'sheet'): string {
  return renderToStaticMarkup(
    createElement(Dialog, {
      open,
      title: 'Delete expense',
      onClose: () => undefined,
      variant,
      children: createElement('p', null, 'Are you sure?'),
    }),
  );
}

describe('dialog contract', () => {
  it('renders a labelled modal with its title as the heading inside it', () => {
    const html = dialog(true);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Delete expense"');
    expect(html).toContain('<h2 class="text-section font-semibold text-ink">Delete expense</h2>');
    // The overlay covers the screen, so a centred dialog is centred over all of it.
    expect(html).toContain('fixed inset-0');
    expect(html).toContain('Are you sure?');
  });

  it('centres the dialog variant and hangs the sheet from the bottom on phones', () => {
    const centred = dialog(true);
    const sheet = dialog(true, 'sheet');

    expect(centred).toContain('items-center');
    expect(centred).not.toContain('items-end');

    // Bottom on a phone, centred from `sm` up, with the bottom corners squared off so it reads as
    // a sheet rather than a floating card that happens to be low.
    expect(sheet).toContain('items-end');
    expect(sheet).toContain('sm:items-center');
    expect(sheet).toContain('rounded-b-none');
  });

  it('renders nothing at all while it is closed', () => {
    // Not decoration: every dialog in this app is closed on a cold load, and this is what keeps
    // the page behind it — and the live regions the panels are asserted to have exactly one of —
    // unaffected by a control nobody has opened yet.
    expect(dialog(false)).toBe('');
    expect(dialog(false, 'sheet')).toBe('');
  });
});

describe('menu contract', () => {
  it('wraps the arrow keys at both ends', () => {
    expect(stepMenuItem(0, 'ArrowDown', 2)).toBe(1);
    expect(stepMenuItem(1, 'ArrowDown', 2)).toBe(0);
    expect(stepMenuItem(0, 'ArrowUp', 2)).toBe(1);
    expect(stepMenuItem(2, 'ArrowUp', 3)).toBe(1);
  });

  it('jumps to the ends on Home and End', () => {
    expect(stepMenuItem(1, 'Home', 3)).toBe(0);
    expect(stepMenuItem(1, 'End', 3)).toBe(2);
  });

  it('answers null for an empty menu and for a key that is not the menu’s business', () => {
    // Null is what leaves the key to the browser rather than swallowing it, and an empty list is
    // what a menu whose items have not mounted yet passes.
    expect(stepMenuItem(0, 'ArrowDown', 0)).toBeNull();
    expect(stepMenuItem(0, 'Escape', 2)).toBeNull();
    expect(stepMenuItem(0, 'ArrowLeft', 2)).toBeNull();
    expect(stepMenuItem(0, 'Tab', 2)).toBeNull();
  });

  it('claims Escape and nothing else', () => {
    expect(menuKeyIntent('Escape')).toBe('close');
    expect(menuKeyIntent('Enter')).toBeNull();
    expect(menuKeyIntent('ArrowDown')).toBeNull();
  });

  it('renders the panel as a labelled menu whose items are full-width 44px rows', () => {
    const html = renderToStaticMarkup(
      createElement(MenuPanel, {
        id: 'row-menu',
        label: 'Actions for Dinner',
        children: createElement(
          'button',
          { type: 'button', role: 'menuitem', className: MENU_ITEM_CLASSES },
          'Delete',
        ),
      }),
    );

    expect(html).toContain('id="row-menu"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Actions for Dinner"');
    expect(html).toContain('role="menuitem"');
    // The shared item shape: a whole row is the target, and it is at least a thumb tall.
    expect(html).toContain('min-h-11');
    expect(html).toContain('w-full');
  });
});
