import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileForm } from '../../components/profile-form';
import {
  PROFILE_REFUSAL_MESSAGE,
  PROFILE_SAVED_MESSAGE,
  type ProfileNotice,
} from '../../lib/auth/validation';

/**
 * The profile notice slot (AC-3, repro of the issue's finding 3).
 *
 * The slot used to live on the page, which meant it could only ever say what the URL said: after
 * `?saved=1`, a refusal returned inline from the island left the saved sentence sitting above
 * fresh field errors, because nothing on the page knew a submit had happened. The slot is now the
 * island's, and these cases pin the half of that which is visible from a cold render — an idle
 * island paints the notice the page handed it, in the page's own slot, above the card.
 *
 * The other two positions the slot can take are action state rather than markup: the success
 * sentence a just-landed save earns, and the silence a refusal gets. Neither is reachable without
 * a submit, so neither can be asserted here — `renderToStaticMarkup` renders the initial state
 * and nothing else, and there is no jsdom in this tree to click with. They are covered by the
 * acceptance walk instead. What this file will not do is pretend otherwise.
 *
 * Rendered with `renderToStaticMarkup`, the way the server renders it.
 */

function render(notice: ProfileNotice | null): string {
  return renderToStaticMarkup(
    createElement(ProfileForm, {
      displayName: 'Ada',
      currency: 'INR',
      email: 'ada@example.co',
      notice,
    }),
  );
}

describe('the idle profile island', () => {
  it('paints the saved notice in a status slot above the card, as the page did', () => {
    const html = render({ tone: 'lent', text: PROFILE_SAVED_MESSAGE });

    expect(html).toContain('role="status"');
    expect(html).toContain(PROFILE_SAVED_MESSAGE);
    // The slot is above the card, and the card is the email line and the form — the markup the
    // page used to render, now that the island renders both.
    expect(html.indexOf(PROFILE_SAVED_MESSAGE)).toBeLessThan(html.indexOf('ada@example.co'));
    expect(html.indexOf(PROFILE_SAVED_MESSAGE)).toBeLessThan(html.indexOf('profile-displayName'));
    expect(html).toContain('Ada');
  });

  it('paints the legacy refusal in the same slot, answered by the same alert role', () => {
    const html = render({ tone: 'danger', text: PROFILE_REFUSAL_MESSAGE });

    expect(html).toContain('role="alert"');
    expect(html).toContain(PROFILE_REFUSAL_MESSAGE);
    expect(html.indexOf(PROFILE_REFUSAL_MESSAGE)).toBeLessThan(html.indexOf('ada@example.co'));
  });

  it('renders no notice slot at all when the query carried none', () => {
    const html = render(null);

    // Not an empty slot: the page's slot was conditional too, and an island that always rendered
    // one would put a stray empty paragraph on every profile view.
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    // The rest of the screen is unaffected by the slot's absence.
    expect(html).toContain('ada@example.co');
    expect(html).toContain('profile-displayName');
    expect(html).toContain('Save');
  });
});
