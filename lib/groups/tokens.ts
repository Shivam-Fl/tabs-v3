import { randomToken } from '../random';

/**
 * Invite links (TR-7). The token is the whole secret in `/join/<token>`: anybody holding it can
 * join the group, so it is minted from the same CSPRNG as a session token and never derived
 * from anything about the group (an id, a name, a counter) that could be guessed from one link
 * and replayed against another.
 *
 * Rotating is issuing a fresh one of these and storing it over the old value, which is what
 * kills the previous link — there is no expiry to reason about and nothing to clean up.
 */
export function generateInviteToken(): string {
  return randomToken();
}
