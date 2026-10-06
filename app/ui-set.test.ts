import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as interactive from '../components/ui-interactive';
import { SegmentedControl, stepSegment } from '../components/ui-interactive';
import { Avatar, avatarInitials, avatarTint, Button, MoneyInput, Spinner } from '../components/ui';

/**
 * The shared component set (AC-8, ui.md's components).
 *
 * These are the pieces every screen builds on, so the contracts worth pinning are the ones a
 * later screen would be broken by: initials that never slice a character in half, a colour that
 * belongs to the member rather than to the render, a pending button that cannot be submitted
 * twice and still says what it is doing, a money field that announces itself as decimal, and a
 * segmented control that is one tab stop with one selected option.
 *
 * Rendered the way the server renders them — `renderToStaticMarkup` rather than a DOM, because
 * vitest here runs in a node environment with no jsdom. That is enough for everything that is a
 * matter of markup, and the two behaviours that are not (where an arrow key moves, which key the
 * menu claims) are exported as arithmetic and asserted directly, the same way the settle-up row
 * key is. What it cannot show is anything that needs a live input or a click; nothing here
 * pretends otherwise.
 *
 * It lives under `app/` rather than beside the components because vitest.config.ts collects
 * `lib/**`, `app/**` and `scripts/**` only — the same reason the group tests sit in this tree.
 */

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe('avatar initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(avatarInitials('Ada Lovelace')).toBe('AL');
    expect(avatarInitials('grace hopper')).toBe('GH');
  });

  it('handles one word and no name at all', () => {
    expect(avatarInitials('Ada')).toBe('A');
    expect(avatarInitials('')).toBe('');
    expect(avatarInitials('   ')).toBe('');
  });

  it('keeps a Devanagari syllable whole', () => {
    // अनु is अ followed by न with its vowel sign — one user-perceived character per cluster. A
    // code-unit split would keep the vowel sign as a stray combining mark.
    expect(avatarInitials('अनु')).toBe('अ');
  });

  it('never slices an astral-plane character into a lone surrogate', () => {
    const initials = avatarInitials('👩‍🚀 Nag');

    // A code-unit split of the astronaut would leave the high surrogate (0xD83D) on its own;
    // the whole emoji is one code point (0x1F469) followed by its joiner and rocket.
    expect(initials.codePointAt(0)).toBe(0x1f469);
    expect(initials).toBe('👩‍🚀N');
  });
});

describe('avatar colour', () => {
  it('is derived from the member id and is the same on every render', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(avatarTint(id)).toBe(avatarTint(id));

    const first = render(createElement(Avatar, { name: 'Ada Lovelace', memberId: id }));
    const second = render(createElement(Avatar, { name: 'Ada Lovelace', memberId: id }));
    expect(first).toBe(second);
    expect(first).toContain(avatarTint(id));
  });

  it('follows the member, not the name', () => {
    const id = '22222222-2222-4222-8222-222222222222';

    // Renaming somebody must not recolour them: the tint is the id's, which is what makes an
    // avatar a way to recognise a person rather than decoration on a row.
    const ada = render(createElement(Avatar, { name: 'Ada', memberId: id }));
    const bo = render(createElement(Avatar, { name: 'Bo', memberId: id }));
    expect(ada).toContain(avatarTint(id));
    expect(bo).toContain(avatarTint(id));
  });
});

describe('avatar as decoration', () => {
  it('renders the name beside it, with the avatar hidden from assistive technology', () => {
    const html = render(createElement(Avatar, { name: 'Ada Lovelace' }));

    // The initials are a memory aid, never the name: the avatar is aria-hidden and the caller
    // renders the person's name as text next to it, so a screen reader reads it once.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('AL');
    expect(html).not.toContain('Ada Lovelace');
  });

  it('falls back to a decorative icon when there is no name yet', () => {
    const html = render(createElement(Avatar, { name: '' }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<svg');
  });
});

describe('pending button', () => {
  it('disables the submit and says what it is doing', () => {
    const html = render(
      createElement(Button, { type: 'submit', pending: true, pendingLabel: 'Saving…' }, 'Save'),
    );

    // Disabled is what makes a double submit impossible; the label is what makes the state
    // legible without the spinner, which is the half that survives reduced motion.
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Saving…');
    expect(html).not.toContain('>Save<');
  });

  it('renders its own label and stays submittable when it is not pending', () => {
    const html = render(createElement(Button, { type: 'submit' }, 'Add expense'));

    expect(html).toContain('Add expense');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-busy');
  });

  it('marks the spinner as decoration', () => {
    // The animation is never the only signal — the text beside it is — so the spinner is
    // hidden from assistive technology and from the reduced-motion reader alike.
    expect(render(createElement(Spinner))).toContain('aria-hidden="true"');
  });
});

describe('money input', () => {
  it('carries the currency inside the field and raises a decimal pad', () => {
    const html = render(
      createElement(MoneyInput, { id: 'amount', label: 'Amount', currency: '₹' }),
    );

    expect(html).toContain('₹');
    // Attribute names are case-insensitive in HTML, and react-dom/server writes the prop's own
    // casing through — the browser reads this as `inputmode` either way.
    expect(/inputmode="decimal"/i.test(html)).toBe(true);
    expect(html).toContain('text-right');
    expect(html).toContain('tabular-nums');
    // The symbol is part of the field, not a second label a screen reader would read out.
    expect(html).toContain('aria-hidden="true"');
  });

  it('reports itself valid until it is refused', () => {
    const ok = render(createElement(MoneyInput, { id: 'amount', label: 'Amount', currency: '$' }));
    expect(ok).toContain('aria-invalid="false"');

    const bad = render(
      createElement(MoneyInput, {
        id: 'amount',
        label: 'Amount',
        currency: '$',
        error: 'Enter an amount.',
      }),
    );
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toContain('Enter an amount.');
    expect(bad).toContain('aria-describedby="amount-error"');
  });
});

describe('segmented control', () => {
  const options = [
    { value: 'equal', label: 'Equally' },
    { value: 'exact', label: 'Exact amounts' },
    { value: 'shares', label: 'Shares' },
  ] as const;

  it('marks exactly one option selected and keeps one tab stop', () => {
    const html = render(
      createElement(SegmentedControl, {
        label: 'Split type',
        options,
        value: 'exact',
        onChange: () => {},
      }),
    );

    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect((html.match(/role="radio"/g) ?? []).length).toBe(3);
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((html.match(/tabindex="-1"/g) ?? []).length).toBe(2);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Split type"');
  });

  it('moves with the arrow keys, wrapping at both ends', () => {
    expect(stepSegment(0, 'ArrowRight', 3)).toBe(1);
    expect(stepSegment(2, 'ArrowRight', 3)).toBe(0);
    expect(stepSegment(0, 'ArrowLeft', 3)).toBe(2);
    expect(stepSegment(2, 'ArrowDown', 3)).toBe(0);
    expect(stepSegment(0, 'Home', 3)).toBe(0);
    expect(stepSegment(1, 'End', 3)).toBe(2);
  });

  it('leaves every other key to the browser', () => {
    // Null is what makes the control not swallow Tab, Enter or a letter key — the component
    // only handles the keys it is naming.
    expect(stepSegment(0, 'Tab', 3)).toBeNull();
    expect(stepSegment(0, 'Enter', 3)).toBeNull();
    expect(stepSegment(0, 'a', 3)).toBeNull();
  });
});

/**
 * The UTC-labelled time cluster was orphaned when the feed moved to `components/timestamp.tsx`,
 * and its only renderer printed the "UTC" text the product bans. It is gone; this pins that it
 * does not drift back into the shared interactive module (TR-11).
 */
describe('the interactive module and time', () => {
  it('exports none of the time helpers', () => {
    const exported = Object.keys(interactive);

    for (const name of [
      'Timestamp',
      'timestampLabel',
      'utcTimestampText',
      'relativeTimestamp',
      'humanTimestamp',
    ]) {
      expect(exported).not.toContain(name);
    }
  });
});
