import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ExpenseEditorLoading from './loading';

/**
 * The expense editor's loading boundary (AC-9).
 *
 * The point of this file's subject is what it is *not*: a form skeleton, never the ledger. The
 * editor routes are below the group page's segment, so without this boundary they would inherit
 * the group skeleton and a reader would watch a summary card and expense rows paint before the
 * form they asked for replaced them. Rendered the way the server renders it, for the reason the
 * group boundary's test is.
 */
function render(): string {
  return renderToStaticMarkup(ExpenseEditorLoading());
}

describe('expense editor loading boundary', () => {
  it('renders a form-shaped fallback', () => {
    const html = render();

    expect(html).toContain('data-skeleton="expense-form"');
    expect(html).toContain('data-skeleton="editor-title"');

    const fields = html.match(/data-skeleton="expense-field"/g) ?? [];
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-skeleton="expense-submit"');
  });

  it('never renders the group skeleton it is standing in front of', () => {
    const html = render();

    for (const marker of ['expense-row', 'summary', 'tab"', 'group-avatar']) {
      expect(html).not.toContain(`data-skeleton="${marker}`);
    }
  });

  it('announces the wait, motion-safe only', () => {
    const html = render();

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
