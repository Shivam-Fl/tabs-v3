import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InvitePanel } from '../../../../components/groups-panels';
import { MembersScreen } from '../../../../components/members-screen';

/**
 * The archived members screen (AC-2, repro of the issue's findings 2 and 4).
 *
 * An archived group is read-only, and every control the members screen offers past the roster is
 * dead on one: joining filters archived groups out of the invite lookup, rotate and disable both
 * answer with the archived refusal, and seats cannot be added. The old screen kept rendering all
 * of it — a solo owner's "share the invite link" prompt whose action returned null, and an invite
 * panel whose link nobody could use — so the assertions here are about what is *absent* as much as
 * what is present.
 *
 * Rendered the way the server renders it — `renderToStaticMarkup`, because vitest here runs in a
 * node environment with no jsdom. The panels are client islands whose only hooks are
 * `useActionState` and a `useEffect` that the server does not run, so their initial markup is
 * exactly what a cold page load receives. What it cannot show is anything behind a click; the
 * archived branches all live in the first paint, which is why they are coverable here while the
 * leave-refusal branches are not.
 */

const AT = new Date('2026-01-01T00:00:00Z');
const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_USER_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const SEAT_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_NAME = 'Goa trip';

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

function invitePanel(archived: boolean, inviteNotice: string | null = null): string {
  return renderToStaticMarkup(
    createElement(InvitePanel, {
      groupId: GROUP_ID,
      groupName: GROUP_NAME,
      invitePath: '/join/tok-abc',
      inviteEnabled: true,
      inviteNotice,
      archived,
    }),
  );
}

function screen(archived: boolean, seats: Seat[]): string {
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
          name: GROUP_NAME,
          currency: 'INR',
          type: 'trip',
          inviteToken: 'tok-abc',
          inviteEnabled: true,
          archived,
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
      removedName: null,
      inviteNotice: null,
    }),
  );
}

describe('the invite panel', () => {
  it('offers nothing but one read-only sentence on an archived group', () => {
    const html = invitePanel(true, 'New invite link created. The old one no longer works.');

    expect(html).toContain('This group is archived, so nobody new can join.');
    // Nothing to copy, and nothing that says a link exists to copy.
    expect(html).not.toContain('id="invite-url"');
    expect(html).not.toContain('>Copy<');
    expect(html).not.toContain('Create link');
    expect(html).not.toContain('Rotate link');
    expect(html).not.toContain('Disable link');
    expect(html).not.toContain('Anyone signed in who opens this link can join.');
    // No notice slot either: a success sentence about an unusable link is noise, so even a page
    // that handed one over does not get it painted.
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('New invite link created');
  });

  it('still renders the link and its controls on a live group', () => {
    const html = invitePanel(false);

    expect(html).toContain('id="invite-url"');
    expect(html).toContain('>Copy<');
    expect(html).toContain('Rotate link');
    expect(html).toContain('Disable link');
    expect(html).toContain('Anyone signed in who opens this link can join.');
    expect(html).not.toContain('This group is archived');
  });

  it('still renders the invite notice it is handed on a live group', () => {
    const html = invitePanel(false, 'Invite link disabled. Nobody can join with it until you create a new one.');

    expect(html).toContain('role="status"');
    expect(html).toContain('Invite link disabled.');
  });
});

describe('a solo owner', () => {
  it('is not offered the invite prompt on an archived group', () => {
    const html = screen(true, [OWNER]);

    expect(html).not.toContain('Nobody else is here yet');
    expect(html).not.toContain('Share the invite link');
    expect(html).not.toContain('Copy invite link');
    // What an archived group does say, instead: the read-only invite sentence and the seats note.
    expect(html).toContain('This group is archived, so nobody new can join.');
    expect(html).toContain('This group is archived, so seats cannot be added to it.');
    expect(html).not.toContain('Add someone by name');
  });

  it('still gets the empty state, with its working action, on a live group', () => {
    const html = screen(false, [OWNER]);

    expect(html).toContain('Nobody else is here yet');
    expect(html).toContain('Share the invite link');
    expect(html).toContain('Copy invite link');
    expect(html).toContain('Add someone by name');
    expect(html).not.toContain('This group is archived');
  });

  it('leaves an archived group with more than one member on the plain roster', () => {
    const html = screen(true, [OWNER, SECOND]);

    expect(html).not.toContain('Nobody else is here yet');
    expect(html).toContain('Bo');
    expect(html).toContain('This group is archived, so seats cannot be added to it.');
    expect(html).not.toContain('Add someone by name');
  });
});
