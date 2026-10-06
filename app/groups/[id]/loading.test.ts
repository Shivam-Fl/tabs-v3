import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ExpenseEditorLoading from './expenses/loading';
import GroupLoading from './loading';

/**
 * The group loading boundary (AC-9).
 *
 * Rendered the way the server renders it — the component called as a function and the element
 * tree turned into static markup — so what is asserted is the markup a cold navigation receives
 * rather than a copy of the source. It is asserted here rather than in a browser because it has
 * to be: the embedded database resolves in the microtask queue, so a group page loads before the
 * streamed fallback can paint, and the fallback is exactly the thing that is never visible
 * locally (the QA environment notes say the same in fewer words).
 */
function render(): string {
  return renderToStaticMarkup(GroupLoading());
}

describe('group loading boundary', () => {
  it('paints the summary card, the tab bar and skeleton expense rows instead of a blank page', () => {
    const html = render();

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

  it('paints the header the data will fill, so nothing moves when it arrives', () => {
    const html = render();

    expect(html).toContain('data-skeleton="group-avatar"');
    expect(html).toContain('data-skeleton="group-name"');
  });

  it('announces the wait to assistive technology', () => {
    const html = render();

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading this group');
    expect(html).toContain('aria-busy="true"');
  });

  it('tells a scriptless reader that JavaScript is required instead of stranding a loader', () => {
    // BUG-2/T-14: with scripting off the route boundary is the paint, and the resolved ledger sits
    // in a hidden Flight payload that no swap can reveal — so this fallback is what the reader
    // keeps, pulsing forever. AC-16 replaces that stranded loader with a designed message naming
    // the requirement. (`<noscript>` renders only when scripting is off, so JS-enabled paint is
    // untouched by it.)
    const html = render();

    expect(html).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });

  it('pulses only for a viewer who has not asked for less motion', () => {
    const html = render();

    const blocks = html.match(/<[a-z]+[^>]*bg-muted\/20[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const block of blocks) {
      expect(block).toContain('motion-safe:animate-pulse');
    }
  });

  it('does not render inside the expenses segments, which keep their own boundary', () => {
    // Next uses the nearest loading.tsx above a segment, so the thing that keeps this fallback
    // off the editor routes is the boundary sitting between them — a file, which is the only
    // part of a routing decision a unit test here can see.
    expect(existsSync(new URL('./expenses/loading.tsx', import.meta.url))).toBe(true);

    const editor = renderToStaticMarkup(ExpenseEditorLoading());
    expect(editor).not.toContain('data-skeleton="expense-row"');
    expect(editor).not.toContain('data-skeleton="summary"');
    expect(editor).not.toContain('data-skeleton="tab"');
  });
});
