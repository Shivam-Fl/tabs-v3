import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorFormSkeleton, GroupPageSkeleton } from '../../../components/group-skeletons';

/**
 * The two skeletons the group screens paint while their data is on its way (AC-9).
 *
 * Rendered the way the server renders them — the component called as a function and the element
 * tree turned into static markup — so what is asserted is the markup a cold navigation receives
 * rather than a copy of the source. It is asserted here rather than in a browser because it has
 * to be: the embedded database resolves in the microtask queue, so a group page loads before a
 * fallback can paint, and the fallback is exactly the thing that is never visible locally (the QA
 * environment notes say the same in fewer words).
 *
 * It lives in this directory rather than beside the module for the reason the sibling
 * `groups-panels.test.ts` gives: `vitest.config.ts` collects `lib/**`, `app/**` and `scripts/**`
 * only, so a `components/*.test.ts` would be collected by nothing and would prove nothing.
 */
function group(): string {
  return renderToStaticMarkup(GroupPageSkeleton());
}

function editor(): string {
  // Called the way React calls it — with a props object — rather than as a bare function call: its
  // `place` is read off that object, and there is no component to mount a Suspense boundary inside
  // a unit test.
  return renderToStaticMarkup(EditorFormSkeleton({}));
}

describe('the group page skeleton', () => {
  it('paints the summary card, the tab bar and skeleton expense rows instead of a blank page', () => {
    const html = group();

    expect(html).toContain('data-skeleton="summary"');
    expect(html).toContain('data-skeleton="summary-hero"');
    expect(html).toContain('data-skeleton="tabs"');

    const tabs = html.match(/data-skeleton="tab"/g) ?? [];
    expect(tabs.length).toBeGreaterThanOrEqual(4);

    const rows = html.match(/data-skeleton="expense-row"/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Rows, not one block standing in for the list: ui.md asks for skeletons shaped like the
    // content they are standing in for, and a single bar would move when the list arrives.
    expect(html).toContain('<li');
  });

  it('does not paint a header of its own', () => {
    // BUG-1's other half. The group page renders its breadcrumb and header synchronously from the
    // guard's own result, so a header-shaped block in this fallback would print a second header
    // directly under the real one — and the reader would watch it be replaced by the same header.
    const html = group();

    expect(html).not.toContain('data-skeleton="group-avatar"');
    expect(html).not.toContain('data-skeleton="group-name"');
    // And no shell of its own: the page's own shell is already around this fallback, so a second
    // one would be a second top bar, not a first paint.
    expect(html).not.toContain('<header');
  });

  it('announces the wait to assistive technology', () => {
    const html = group();

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading this group');
    expect(html).toContain('aria-busy="true"');
  });

  it('tells a scriptless reader that JavaScript is required instead of stranding a loader', () => {
    // BUG-2/T-14, kept: with scripting off the fallback is what the reader keeps, and the resolved
    // ledger sits in a hidden Flight payload that no swap can reveal. AC-16 replaces that stranded
    // loader with a designed message naming the requirement. (`<noscript>` renders only when
    // scripting is off, so JS-enabled paint is untouched by it.)
    const html = group();

    expect(html).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });

  it('pulses only for a viewer who has not asked for less motion', () => {
    const html = group();

    const blocks = html.match(/<[a-z]+[^>]*bg-muted\/20[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const block of blocks) {
      expect(block).toContain('motion-safe:animate-pulse');
    }
  });
});

describe('the expense editor skeleton', () => {
  it('renders a form-shaped fallback', () => {
    const html = editor();

    expect(html).toContain('data-skeleton="expense-form"');
    expect(html).toContain('data-skeleton="editor-title"');

    const fields = html.match(/data-skeleton="expense-field"/g) ?? [];
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-skeleton="expense-submit"');
  });

  it('never renders the group skeleton it is standing in front of', () => {
    const html = editor();

    for (const marker of ['expense-row', 'summary', 'tab"', 'group-avatar']) {
      expect(html).not.toContain(`data-skeleton="${marker}`);
    }
  });

  it('wears the shell it is standing in for, so the top bar does not arrive with the form', () => {
    // The editors render nothing above their read, so unlike the group page's fallback this one
    // has to carry the shell itself — and it names the place the guard already resolved.
    const html = renderToStaticMarkup(EditorFormSkeleton({ place: 'Ski trip' }));

    expect(html).toContain('<header');
    expect(html).toContain('Ski trip');
  });

  it('announces the wait, motion-safe only', () => {
    const html = editor();

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading the expense form');
    expect(html).toContain('aria-busy="true"');

    const blocks = html.match(/<[a-z]+[^>]*bg-muted\/20[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const block of blocks) {
      expect(block).toContain('motion-safe:animate-pulse');
    }
  });
});
