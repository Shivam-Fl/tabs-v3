import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MembersLoading from './loading';

/**
 * The members loading boundary (AC-12, repro of BUG-4).
 *
 * Rendered the way the server renders it — the component called as a function and the element
 * tree turned into static markup — so the assertions are about the markup a cold navigation
 * actually receives rather than about a copy of the source. Before this file's subject existed,
 * the members route had no boundary at all and there was nothing here to render.
 */
function render(): string {
  return renderToStaticMarkup(MembersLoading());
}

describe('members loading boundary', () => {
  it('paints skeleton member rows instead of a blank page', () => {
    const html = render();

    const rows = html.match(/data-skeleton="member-row"/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Rows, not one block standing in for the list: ui.md asks for skeletons matching the
    // final layout.
    expect(html).toContain('<li');
  });

  it('paints the invite panel with a loading button state', () => {
    const html = render();

    expect(html).toContain('data-skeleton="invite-button"');
    expect(html).toContain('data-skeleton="invite-field"');
  });

  it('announces the wait to assistive technology', () => {
    const html = render();

    expect(html).toContain('role="status"');
    expect(html).toContain('Loading members');
    expect(html).toContain('aria-busy="true"');
  });

  it('tells a reader without JavaScript what is missing', () => {
    const html = render();

    expect(html).toMatch(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
  });

  it('pulses only for a viewer who has not asked for less motion', () => {
    const html = render();

    // Every skeleton block is a token-filled placeholder, and every one of them animates as
    // `motion-safe:` — which globals.css turns off for a viewer who asked for less motion,
    // the same trade ui.md draws for the rest of the product.
    const blocks = html.match(/<[a-z]+[^>]*bg-muted\/20[^>]*>/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    for (const block of blocks) {
      expect(block).toContain('motion-safe:animate-pulse');
    }
  });
});
