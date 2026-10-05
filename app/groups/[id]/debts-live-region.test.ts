import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeletePaymentForm, SettleUpForm } from '../../../components/settle-panels';
import { StateMessage } from '../../../components/ui';

/**
 * The debts card's live regions (AC-9, TR-9, repro of BUG-1/T-12).
 *
 * The assertion is about *when* the region exists, not about what it says, because that is the
 * whole defect: a region inserted together with the message it carries is announced unreliably,
 * while an empty region that was already on the page announces the text that fills it. So every
 * case here renders the panel the way the server renders it — idle, before anybody has submitted
 * anything — and asks whether the polite region is already there.
 *
 * Rendered through `renderToStaticMarkup` rather than a DOM: the question is the markup a cold
 * page load receives, and the panels are client islands whose only hook is `useActionState`,
 * which renders its initial state on the server exactly as it does in a browser.
 */

const TRANSFER = {
  fromMembershipId: '11111111-1111-4111-8111-111111111111',
  toMembershipId: '22222222-2222-4222-8222-222222222222',
  fromDisplayName: 'Ada',
  toDisplayName: 'Bo',
  amountMinor: 1250,
};

const PAYMENT = {
  id: '33333333-3333-4333-8333-333333333333',
  fromDisplayName: 'Ada',
  toDisplayName: 'Bo',
  amountMinor: 1250,
};

/** The polite status region's markup — its opening tag and what it currently says — or null. */
function statusRegion(html: string): { tag: string; content: string } | null {
  const match = html.match(/(<p role="status" aria-live="polite"[^>]*>)([\s\S]*?)<\/p>/);
  return match ? { tag: match[1], content: match[2] } : null;
}

/** Every live region in a render, whatever it claims to be. */
function liveRegions(html: string): string[] {
  return html.match(/<p[^>]*aria-live=[^>]*>/g) ?? [];
}

function settleUp(transfers: (typeof TRANSFER)[]): string {
  return renderToStaticMarkup(
    createElement(SettleUpForm, {
      groupId: 'group-1',
      currency: 'USD',
      transfers,
      archived: false,
    }),
  );
}

function deletePayment(payments: (typeof PAYMENT)[]): string {
  return renderToStaticMarkup(
    createElement(DeletePaymentForm, {
      groupId: 'group-1',
      currency: 'USD',
      payments,
      archived: false,
    }),
  );
}

describe('debts card live regions', () => {
  it('mounts the settle-up region empty, before anything has been submitted', () => {
    const html = settleUp([TRANSFER]);
    const region = statusRegion(html);

    // The failure this file exists for: with `StateMessage` returning null while idle, this is
    // null and the panel ships with zero live regions until the first result inserts one.
    expect(region).not.toBeNull();
    expect(region?.content).toBe('');
    // Empty, and alone: a second region announcing the same outcome is a second thing to keep
    // in sync.
    expect(liveRegions(html)).toHaveLength(1);
  });

  it('mounts the settle-up region empty on the settled branch too', () => {
    const html = settleUp([]);

    // The last payment of a group is the one that empties this list, so the branch that renders
    // when there is nothing left to pay is the one that most needs its region already mounted.
    expect(html).toContain('Everyone is settled up');
    expect(statusRegion(html)?.content).toBe('');
    expect(liveRegions(html)).toHaveLength(1);
  });

  it('mounts the delete region empty, before anything has been deleted', () => {
    expect(statusRegion(deletePayment([]))?.content).toBe('');
    expect(statusRegion(deletePayment([PAYMENT]))?.content).toBe('');
  });

  it('fills the region that was already there rather than inserting a new one', () => {
    const idle = renderToStaticMarkup(
      createElement(StateMessage, { state: { status: 'idle', message: '' } }),
    );
    const success = renderToStaticMarkup(
      createElement(StateMessage, { state: { status: 'success', message: 'Payment recorded.' } }),
    );

    const before = statusRegion(idle);
    const after = statusRegion(success);
    expect(after?.content).toBe('Payment recorded.');
    // The same node: same tag, same role, same aria-live, same classes. That is what makes this
    // an update to a region a screen reader has already been watching.
    expect(after?.tag).toBe(before?.tag);
  });

  it('keeps a refusal polite and on the same region shape', () => {
    const html = renderToStaticMarkup(
      createElement(StateMessage, { state: { status: 'error', message: 'Enter an amount more than zero.' } }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Enter an amount more than zero.');
  });
});
