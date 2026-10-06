import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MembersScreen } from '../../../../components/members-screen';
import {
  GROUP_NAME_MAX,
  PLACEHOLDER_NAME_MAX,
  removedNoticeText,
} from '../../../../lib/groups/validation';

/**
 * The maxima wrap instead of widening the page (AC-1, AC-2, AC-3, AC-5, AC-7).
 *
 * Both caps the product enforces are 80 characters and neither forbids a string with nothing in
 * it to break on, so the longest name the forms accept is also the widest thing a page can be
 * asked to render. Without an `overflow-wrap` treatment that string is one unbreakable line, and
 * at a 375px viewport it — not the layout — decides the document width.
 *
 * Two treatments, applied where each belongs: rows keep `truncate` with the whole value in
 * `title`, because ui.md says a long name shortens rather than wrapping a list row into three
 * lines; headings and the sentences that name a group or a person wrap, because a truncated
 * heading stops confirming which group a page is about. The top back-link is the one element
 * that needs more than a class — it is a flex container, and a flex item's automatic minimum
 * size is its min-content width, so `break-words` alone cannot reduce it and the label needs a
 * `min-w-0` box of its own.
 *
 * Rendered the way the server renders it — `renderToStaticMarkup`, because vitest here runs in a
 * node environment with no jsdom — which is also the only way to reach these: every class here is
 * in the first paint of a cold load, and nothing about it is behind a click.
 */

const AT = new Date('2026-01-01T00:00:00Z');
const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const SEAT_ID = '44444444-4444-4444-8444-444444444444';

/** The longest name either form accepts, with nothing in it to break on. */
const LONG_NAME = 'x'.repeat(GROUP_NAME_MAX);
const LONG_SEAT_NAME = 'x'.repeat(PLACEHOLDER_NAME_MAX);

interface Seat {
  id: string;
  userId: string | null;
  displayName: string;
  role: string;
}

const OWNER: Seat = {
  id: OWNER_MEMBERSHIP_ID,
  userId: OWNER_USER_ID,
  displayName: 'Ada',
  role: 'owner',
};

const SECOND: Seat = {
  id: SEAT_ID,
  userId: null,
  displayName: 'Bo',
  role: 'member',
};

function screen({
  groupName,
  seats,
  removedName = null,
}: {
  groupName: string;
  seats: Seat[];
  removedName?: string | null;
}): string {
  return renderToStaticMarkup(
    createElement(MembersScreen, {
      access: {
        status: 'ok',
        user: {
          id: OWNER_USER_ID,
          email: 'ada@example.co',
          displayName: 'Ada',
          currency: 'INR',
        },
        group: {
          id: GROUP_ID,
          name: groupName,
          currency: 'INR',
          type: 'trip',
          inviteToken: 'tok-abc',
          inviteEnabled: true,
          archived: false,
          createdAt: AT,
          updatedAt: AT,
        },
        membership: { ...OWNER, groupId: GROUP_ID, createdAt: AT, updatedAt: AT },
      },
      members: seats.map((seat) => ({ ...seat, createdAt: AT })),
      balances: seats.map((seat) => ({
        membershipId: seat.id,
        userId: seat.userId,
        displayName: seat.displayName,
        balanceMinor: 0,
      })),
      failed: false,
      removedName,
      inviteNotice: null,
    }),
  );
}

/** The page's one h1 — the heading that has to keep naming the group in full. */
function headingTag(html: string): string {
  const match = html.match(/<h1[^>]*>/);
  expect(match, 'expected the screen to render an h1').not.toBeNull();
  return match![0];
}

/** The opening tag of the element that holds the first occurrence of `text`. */
function tagFor(html: string, text: string): string {
  const at = html.indexOf(text);
  expect(at, `expected the markup to contain ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf('<', at);
  return html.slice(open, html.indexOf('>', open) + 1);
}

/** The `<p>` that opens most recently before `at`, for text sitting inside a nested anchor. */
function paragraphBefore(html: string, at: number): string {
  expect(at, 'expected the markup to contain the text').toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf('<p', at);
  expect(open, 'expected a paragraph to open before the text').toBeGreaterThanOrEqual(0);
  return html.slice(open, html.indexOf('>', open) + 1);
}

describe('a max-length group name', () => {
  it('wraps in the heading rather than setting the page width', () => {
    const html = screen({ groupName: LONG_NAME, seats: [OWNER, SECOND] });

    // Named in full in the heading — a heading truncated to an ellipsis would stop saying which
    // group this screen belongs to — and `break-words` is what lets it wrap inside 375px (AC-1).
    expect(headingTag(html)).toContain('break-words');
    expect(html).toContain(`>${LONG_NAME}</h1>`);
  });

  it('wraps in the top back-link, whose label is a min-w-0 box of its own', () => {
    const html = screen({ groupName: LONG_NAME, seats: [OWNER, SECOND] });

    // The label is the first of the two "Back to …" links on the page. It is a flex item inside a
    // shrink-to-fit container, so `min-w-0` is the load-bearing class of the pair: without it the
    // automatic minimum size holds the box at the name's full min-content width (AC-1, AC-2).
    const label = tagFor(html, `Back to ${LONG_NAME}`);
    expect(label).toContain('min-w-0');
    expect(label).toContain('break-words');
  });

  it('wraps in the bottom back-link, which carries the class on its paragraph', () => {
    const html = screen({ groupName: LONG_NAME, seats: [OWNER, SECOND] });

    // The inline anchor cannot be given the class usefully; `overflow-wrap` inherits, so the
    // paragraph hands it down to the link inside (AC-1, AC-2).
    const at = html.lastIndexOf(`Back to ${LONG_NAME}`);
    expect(paragraphBefore(html, at)).toContain('break-words');
  });
});

describe('the removed-member notice', () => {
  it('names the member and the group in full, and wraps, at both maxima', () => {
    const html = screen({
      groupName: LONG_NAME,
      seats: [OWNER, { ...SECOND, displayName: LONG_SEAT_NAME }],
      removedName: LONG_SEAT_NAME,
    });

    const sentence = removedNoticeText(LONG_SEAT_NAME, LONG_NAME);
    expect(html).toContain(sentence);
    expect(tagFor(html, sentence)).toContain('break-words');
  });

  it('wraps the same way when only the removed member’s name is at the maximum', () => {
    const html = screen({
      groupName: 'Goa trip',
      seats: [OWNER, { ...SECOND, displayName: LONG_SEAT_NAME }],
      removedName: LONG_SEAT_NAME,
    });

    const sentence = removedNoticeText(LONG_SEAT_NAME, 'Goa trip');
    expect(html).toContain(sentence);
    expect(tagFor(html, sentence)).toContain('break-words');
  });

  it('wraps the same way when only the group’s name is at the maximum', () => {
    const html = screen({
      groupName: LONG_NAME,
      seats: [OWNER, SECOND],
      removedName: 'Bo',
    });

    const sentence = removedNoticeText('Bo', LONG_NAME);
    expect(html).toContain(sentence);
    expect(tagFor(html, sentence)).toContain('break-words');
  });
});

describe('a placeholder seat with a max-length name', () => {
  it('keeps the row on one line while the sentence under it wraps', () => {
    const html = screen({
      groupName: 'Goa trip',
      seats: [OWNER, { ...SECOND, displayName: LONG_SEAT_NAME }],
    });

    // The row is a list row: it truncates with the whole value in `title`, unchanged by this fix
    // (ui.md, AC-5). `tagFor` lands here on the `title` attribute, which no other element carries.
    const row = tagFor(html, LONG_SEAT_NAME);
    expect(row).toContain('truncate');
    expect(row).toContain(`title="${LONG_SEAT_NAME}"`);

    // The claim sentence below re-prints the same name in full, so it is the one that has to
    // wrap — an 80-character run there would widen the row as surely as one in a heading (AC-7).
    expect(paragraphBefore(html, html.indexOf('Claim this seat from the invite link'))).toContain(
      'break-words',
    );
  });
});

describe('names short enough to fit', () => {
  it('renders exactly what it rendered before — the classes are the whole change', () => {
    const html = screen({ groupName: 'Goa trip', seats: [OWNER, SECOND], removedName: 'Bo' });

    expect(html).toContain('>Goa trip</h1>');
    expect(html).toContain('Back to Goa trip');
    expect(html).toContain(removedNoticeText('Bo', 'Goa trip'));
    // The row still truncates and still carries its name whole in `title` (AC-5).
    expect(tagFor(html, 'title="Bo"')).toContain('truncate');
  });
});
