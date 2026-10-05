import { describe, expect, it } from 'vitest';
import { postAuthIntent } from '../components/auth-form';

/**
 * Where the auth island sends somebody whose credentials just checked out (IAC-1, AC-1).
 *
 * The effect that calls this drives the router, and this tree has no jsdom to drive one with, so
 * the decision is exported as data and asserted directly — the same treatment the account menu's
 * key map gets in app-shell.test.ts.
 *
 * The two things the criterion turns on are here: a sign-in lands on Home without a destination
 * and on the invite link's destination with one, and a sign-up never takes the island's
 * navigation at all — its fresh and taken addresses are the same response, so a choice made here
 * would be a choice made on nothing.
 */
describe('the post-auth destination', () => {
  it('sends a successful sign-in Home when the link carried no destination', () => {
    // IAC-1: Home, never Profile. The value is the island's own decision, not a property of
    // whichever URL the browser happened to be on.
    expect(postAuthIntent('signin', null)).toEqual({ kind: 'push', href: '/' });
  });

  it('honours the destination a validated invite link carried', () => {
    expect(postAuthIntent('signin', '/join/abc123')).toEqual({
      kind: 'push',
      href: '/join/abc123',
    });
    expect(postAuthIntent('signin', '/groups/6f0a2b1c-3d4e-4f50-8a9b-0c1d2e3f4a5b')).toEqual({
      kind: 'push',
      href: '/groups/6f0a2b1c-3d4e-4f50-8a9b-0c1d2e3f4a5b',
    });
  });

  it('never navigates on sign-up, even when the page hands it a destination', () => {
    // A taken address answers exactly as a fresh one does, and the island sees only that answer.
    // Refreshing is what lets the server page redirect the visitor who now holds a session and
    // leave the neutral success on screen for the one who does not.
    expect(postAuthIntent('signup', null)).toEqual({ kind: 'refresh' });
    expect(postAuthIntent('signup', '/join/abc123')).toEqual({ kind: 'refresh' });
  });
});
