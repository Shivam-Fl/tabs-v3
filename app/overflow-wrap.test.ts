import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExpenseEditor } from '../components/expense-editor';
import { ExpenseScreen } from '../components/expense-screen';
import { JoinPanel } from '../components/groups-panels';
import { ConfirmStep, StateMessage } from '../components/ui';
import type { ExpenseEditorData } from '../lib/expenses/queries';
import { DESCRIPTION_MAX } from '../lib/expenses/validation';
import { GROUP_NAME_MAX, PLACEHOLDER_NAME_MAX } from '../lib/groups/validation';

/**
 * The maxima wrap instead of widening the page (AC-1 … AC-6).
 *
 * The same root cause PR #54 proved on the group and members pages, in the seven spots it did not
 * reach: an unbroken string at the product's own maximum — 80 characters for a group or seat
 * name, 80 for a user display name, 200 for an expense description — rendered with no
 * `overflow-wrap` treatment becomes one unbreakable line, and at a 375px viewport that line, not
 * the layout, sets the document width.
 *
 * Two treatments, applied where each belongs, exactly as #54 applied them. A block-level heading
 * or sentence the server hands a whole column gets `break-words` (a truncated heading stops
 * saying which group the page is about). A string held by a flex container needs a `min-w-0` box
 * as well, because a flex item's automatic minimum size is its min-content width and
 * `overflow-wrap: break-word` cannot reduce it — the buttons below are flex containers, and so is
 * the breadcrumb row. Rows keep `truncate` with the whole value in `title`; `break-words` and
 * `min-w-0` are no-ops on ordinary text, so short names must render exactly as they did.
 *
 * Rendered the way the server renders it — `renderToStaticMarkup`, because vitest here runs in a
 * node environment with no jsdom — and only with markup that is in the first paint of a cold
 * load: every element here is reachable without a click except the editor's several-payers
 * disclosure, which opens on state the editor is handed rather than on anything a test does.
 *
 * It lives under `app/` rather than beside the components because `vitest.config.ts` includes
 * `lib/**`, `app/**` and `scripts/**` only: a `components/*.test.ts` would be collected by
 * nothing and would prove nothing.
 *
 * The honest limit: a cold render proves the classes are on the elements, not the pixel widths.
 * The in-app `scrollWidth` reads are QA's, per the acceptance criteria, on a running stack.
 */

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const ADA = '22222222-2222-4222-8222-222222222222';
const SEAT = '33333333-3333-4333-8333-333333333333';

/** The longest name each form accepts, with nothing in it to break on. */
const LONG_GROUP = 'x'.repeat(GROUP_NAME_MAX);
const LONG_SEAT = 'z'.repeat(PLACEHOLDER_NAME_MAX);
const LONG_DESCRIPTION = 'y'.repeat(DESCRIPTION_MAX);

const NEW_TITLE = `Add an expense to ${LONG_GROUP}`;
const NEW_SUBTITLE = 'Amounts are in INR. Recorded by Ada.';

/** The page's one h1 — the heading that has to keep naming the group in full. */
function headingTag(html: string): string {
  const match = html.match(/<h1[^>]*>/);
  expect(match, 'expected the screen to render an h1').not.toBeNull();
  return match![0];
}

/** The opening tag of the element that opens most recently before `text`. */
function tagFor(html: string, text: string): string {
  const at = html.indexOf(text);
  expect(at, `expected the markup to contain ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);
  return tagBefore(html, at, '<');
}

/** The opening tag of the most recent element beginning `prefix` before `at`. */
function tagBefore(html: string, at: number, prefix: string): string {
  expect(at, 'expected the markup to contain the text').toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf(prefix, at);
  expect(open, `expected ${prefix} to open before the text`).toBeGreaterThanOrEqual(0);
  return html.slice(open, html.indexOf('>', open) + 1);
}

/** Just the breadcrumb, so a crumb is never confused with the heading that names the same group. */
function breadcrumb(html: string): string {
  const start = html.indexOf('<nav aria-label="Breadcrumb"');
  expect(start, 'expected the screen to render the breadcrumb').toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('</nav>', start));
}

function expenseScreen({
  mode = 'new',
  groupName = 'Goa trip',
  title = 'Add an expense to Goa trip',
  subtitle = 'Amounts are in INR. Recorded by Ada.',
  archived = false,
}: {
  mode?: 'new' | 'edit';
  groupName?: string;
  title?: string;
  subtitle?: string;
  archived?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    createElement(ExpenseScreen, {
      mode,
      groupId: GROUP_ID,
      groupName,
      title,
      subtitle,
      archived,
      viewer: { displayName: 'Ada' },
      children: createElement('div', null, 'the editor'),
    }),
  );
}

/** The editor's data as the pages hand it over: several payers opens the per-payer rows. */
function editorData(overrides: Partial<ExpenseEditorData> = {}): ExpenseEditorData {
  return {
    description: 'Dinner',
    amount: '100.00',
    date: '2026-10-05',
    category: 'food',
    note: '',
    splitType: 'equal',
    payers: [
      { membershipId: ADA, displayName: 'Ada', amount: '50.00' },
      { membershipId: SEAT, displayName: LONG_SEAT, amount: '50.00' },
    ],
    participants: [
      { membershipId: ADA, displayName: 'Ada', included: true, value: '' },
      { membershipId: SEAT, displayName: LONG_SEAT, included: true, value: '' },
    ],
    ...overrides,
  };
}

function editor(data: ExpenseEditorData = editorData()): string {
  return renderToStaticMarkup(
    createElement(ExpenseEditor, {
      groupId: GROUP_ID,
      expenseId: null,
      currency: 'INR',
      data,
    }),
  );
}

function joinPanel(groupName: string, seatName: string): string {
  return renderToStaticMarkup(
    createElement(JoinPanel, {
      token: 'tok-abc',
      groupName,
      seats: [{ id: SEAT, displayName: seatName, matchesYou: true }],
    }),
  );
}

describe('the new-expense screen with a max-length group name', () => {
  it('wraps the heading rather than setting the page width', () => {
    const html = expenseScreen({ title: NEW_TITLE, subtitle: NEW_SUBTITLE, groupName: LONG_GROUP });

    // Named in full — a heading truncated to an ellipsis would stop confirming which group the
    // page is about — and `break-words` is what lets it wrap inside 375px (AC-3).
    expect(headingTag(html)).toContain('break-words');
    expect(html).toContain(`>${NEW_TITLE}</h1>`);
  });

  it('wraps the breadcrumb crumb, which is a min-w-0 box of its own', () => {
    const html = expenseScreen({ title: NEW_TITLE, subtitle: NEW_SUBTITLE, groupName: LONG_GROUP });
    const crumb = breadcrumb(html);
    const at = crumb.indexOf(LONG_GROUP);

    // The crumb is a link naming the group, so it follows the members back-link precedent and
    // wraps; the row it sits in is a flex container, so it needs `min-w-0` to be narrower than
    // its own longest word (AC-3). The current-page crumb beside it keeps its `truncate`, because
    // a crumb that names a location may shorten where a crumb that names the group may not.
    const item = tagBefore(crumb, at, '<li');
    expect(item).toContain('min-w-0');
    expect(item).toContain('break-words');
    expect(crumb).toContain(`>${LONG_GROUP}</a>`);
    expect(crumb).toContain('truncate');
  });

  it('wraps the subtitle and the bottom way back', () => {
    const html = expenseScreen({ title: NEW_TITLE, subtitle: NEW_SUBTITLE, groupName: LONG_GROUP });

    expect(tagFor(html, NEW_SUBTITLE)).toContain('break-words');
    expect(tagBefore(html, html.indexOf(`Back to ${LONG_GROUP}`), '<p')).toContain('break-words');
    expect(html).toContain(`>Back to ${LONG_GROUP}</a>`);
  });
});

describe('the edit-expense screen', () => {
  it('wraps a max-length unbroken description in the heading', () => {
    const html = expenseScreen({
      mode: 'edit',
      groupName: LONG_GROUP,
      title: `Edit “${LONG_DESCRIPTION}”`,
      subtitle: `${LONG_GROUP} · amounts in INR`,
    });

    expect(headingTag(html)).toContain('break-words');
    expect(html).toContain(`>Edit “${LONG_DESCRIPTION}”</h1>`);
  });

  it('wraps the subtitle that names the group', () => {
    const html = expenseScreen({
      mode: 'edit',
      groupName: LONG_GROUP,
      title: `Edit “${LONG_DESCRIPTION}”`,
      subtitle: `${LONG_GROUP} · amounts in INR`,
    });

    expect(tagFor(html, `${LONG_GROUP} · amounts in INR`)).toContain('break-words');
  });
});

describe('the expense editor', () => {
  it('wraps the several-payers Remove button label in a min-w-0 box', () => {
    const html = editor();
    const label = `Remove ${LONG_SEAT}`;
    const at = html.indexOf(label);

    // The label is its own box rather than a bare text node: the button is an inline-flex
    // container, so `min-w-0` on the label lets it take the width the row gives it and
    // `break-words` wraps the name inside — the same two-level treatment as the claim button
    // (AC-3). The button shrinks with it.
    expect(tagFor(html, label)).toContain('min-w-0');
    expect(tagFor(html, label)).toContain('break-words');
    expect(tagBefore(html, at, '<button')).toContain('min-w-0');
    expect(html).toContain(`>${label}</span>`);
  });

  it('keeps the single-payer line truncated, as ui.md asks of a row', () => {
    const html = editor(
      editorData({
        payers: [{ membershipId: ADA, displayName: LONG_SEAT, amount: '100.00' }],
        participants: [
          { membershipId: ADA, displayName: LONG_SEAT, included: true, value: '' },
          { membershipId: SEAT, displayName: 'Bo', included: true, value: '' },
        ],
      }),
    );

    // The one-payer summary is a row-axis flex item and truncates with the whole value in
    // `title`; the fix must not have reached in and changed it (AC-5).
    const span = tagFor(html, 'paid the whole amount.');
    expect(span).toContain('truncate');
    expect(html).toContain(`${LONG_SEAT} paid the whole amount.`);
  });
});

describe('the join panel', () => {
  it('wraps the Join button label in a min-w-0 box', () => {
    const html = joinPanel(LONG_GROUP, LONG_SEAT);
    const label = `Join ${LONG_GROUP}`;
    const at = html.indexOf(label);

    expect(tagFor(html, label)).toContain('min-w-0');
    expect(tagFor(html, label)).toContain('break-words');
    expect(tagBefore(html, at, '<button')).toContain('min-w-0');
    expect(html).toContain(`>${label}</span>`);
  });

  it('wraps the claim button label in a min-w-0 box, keeping its own line', () => {
    const html = joinPanel(LONG_GROUP, LONG_SEAT);
    const label = `This is me — claim ${LONG_SEAT}`;
    const at = html.indexOf(label);

    expect(tagFor(html, label)).toContain('min-w-0');
    expect(tagFor(html, label)).toContain('break-words');
    // `min-w-0` joins `ml-auto` rather than replacing it: the button still takes its own line
    // beside the truncated seat name (AC-1).
    const button = tagBefore(html, at, '<button');
    expect(button).toContain('min-w-0');
    expect(button).toContain('ml-auto');
    expect(html).toContain(`>${label}</span>`);
  });

  it('keeps the seat name beside it truncated with its full value in title', () => {
    const html = joinPanel(LONG_GROUP, LONG_SEAT);
    const row = tagFor(html, LONG_SEAT);

    expect(row).toContain('truncate');
    expect(row).toContain(`title="${LONG_SEAT}"`);
  });
});

describe('the shared paragraphs that name an object', () => {
  it('wraps the confirm question, wherever the confirm lives', () => {
    const question = `Remove ${LONG_SEAT} from “${LONG_GROUP}”?`;
    const html = renderToStaticMarkup(
      createElement(ConfirmStep, {
        question,
        confirmLabel: 'Remove member',
        pendingLabel: 'Removing…',
        isPending: false,
        onCancel: () => {},
      }),
    );

    // One class in the shared component covers the remove, archive, rotate, disable and leave
    // confirms on the group and members pages, plus the settle-up and expense-delete dialogs —
    // all of which interpolate the same names into this same `<p>` (AC-2).
    expect(tagFor(html, question)).toContain('break-words');
    expect(html).toContain(question);
  });

  it('wraps the Added and Renamed-to success lines', () => {
    const added = `Added ${LONG_SEAT}. Share the invite link so they can claim the seat.`;
    const addedHtml = renderToStaticMarkup(
      createElement(StateMessage, { state: { status: 'success', message: added } }),
    );

    // The message is the root paragraph, so its own opening tag is the whole first tag.
    const addedTag = addedHtml.slice(0, addedHtml.indexOf('>') + 1);
    expect(addedTag).toContain('min-w-0');
    expect(addedTag).toContain('break-words');
    expect(addedHtml).toContain(added);

    const renamed = `Renamed to ${LONG_GROUP}.`;
    const renamedHtml = renderToStaticMarkup(
      createElement(StateMessage, { state: { status: 'success', message: renamed } }),
    );
    const renamedTag = renamedHtml.slice(0, renamedHtml.indexOf('>') + 1);
    expect(renamedTag).toContain('min-w-0');
    expect(renamedTag).toContain('break-words');
    expect(renamedHtml).toContain(renamed);
  });
});

describe('names short enough to fit', () => {
  it('renders the expense screen exactly as it rendered before — the classes are the change', () => {
    const html = expenseScreen();

    expect(html).toContain('>Add an expense to Goa trip</h1>');
    expect(html).toContain('>Back to Goa trip</a>');
    expect(breadcrumb(html)).toContain('>Goa trip</a>');
    // The shell's place still truncates with the whole value in `title` — the one treatment
    // #54 left alone and this change does not touch (AC-5).
    expect(tagFor(html, 'title="Goa trip"')).toContain('truncate');
  });

  it('renders the join panel exactly as it rendered before', () => {
    const html = joinPanel('Goa trip', 'Bo');

    // Same words, same treatment: a short name is not truncated and gains nothing new. The label
    // moving into a span is the markup change the two buttons share, and it is invisible.
    expect(html).toContain('Join Goa trip');
    expect(html).toContain('This is me — claim Bo');
    expect(tagFor(html, 'title="Bo"')).toContain('truncate');
  });
});
