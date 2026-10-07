import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityFailed, ActivityFeedSkeleton } from '../../components/activity-feed';

/**
 * The cross-group feed's failed state (AC-4, AC-11).
 *
 * The live app gives no way to make a read fail, so the failed branch lives in a component the
 * page hands its filter and scope, and these cases render that component. What they pin is that a
 * failure never widens "this group's activity" into every group's: the chips and Retry both keep
 * the scope.
 */

const GROUP = '11111111-1111-4111-8111-111111111111';

function failed(filter: 'all' | 'expenses' | 'payments' | 'members', groupId: string | null): string {
  return renderToStaticMarkup(createElement(ActivityFailed, { filter, groupId }));
}

describe('ActivityFailed', () => {
  it('keeps the group scope in the chip form and in Retry', () => {
    const html = failed('all', GROUP);

    expect(html).toContain(`<input type="hidden" name="group" value="${GROUP}"/>`);
    expect(html).toContain(`href="/activity?group=${GROUP}"`);
  });

  it('keeps the filter as well as the scope in Retry', () => {
    const html = failed('expenses', GROUP);

    expect(html).toContain(`href="/activity?group=${GROUP}&amp;activity=expenses"`);
  });

  it('carries no scope when there is none', () => {
    const html = failed('all', null);

    expect(html).not.toContain('name="group"');
    expect(html).toContain('href="/activity"');
  });

  it('says what failed and keeps the chips on screen', () => {
    const html = failed('payments', null);

    expect(html).toContain('We could not load your activity');
    expect(html).toContain('aria-label="Filter activity"');
    for (const label of ['All', 'Expenses', 'Payments', 'Members']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('href="/activity?activity=payments"');
  });
});

describe('ActivityFeedSkeleton', () => {
  it('tells a reader without JavaScript what is missing', () => {
    const html = renderToStaticMarkup(createElement(ActivityFeedSkeleton));

    expect(html).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });
});
