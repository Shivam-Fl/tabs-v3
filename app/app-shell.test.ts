import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountMenuPanel, menuKeyIntent, stepMenuItem } from '../components/account-menu';
import { AppShell } from '../components/app-shell';

/**
 * The signed-in chrome (IAC-4, IAC-5).
 *
 * The shell is on every authenticated screen, so the two things pinned here are the ones a screen
 * would silently lose if it drifted: the way Home and the way back are always there, and the page
 * below keeps its own h1 — the shell's place is a label, never a second title.
 *
 * Rendered with `renderToStaticMarkup`, which is what the server does; there is no jsdom in this
 * tree. That covers the closed menu (its initial state, and the state a cold page load has) and
 * the panel's markup directly, since `AccountMenuPanel` is its own component. What it cannot cover
 * is a click that opens the menu or the focus that returns to the avatar — `close()` doing
 * `button.current?.focus()` is a DOM interaction, so the key contract behind it is asserted
 * directly instead, the way the settle-up row key is next door.
 */

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

const MAIN = createElement('main', null, 'content');

describe('the shell', () => {
  it('carries the mark as a link Home', () => {
    const html = render(
      createElement(AppShell, { place: 'Home', viewer: { displayName: 'Ada' }, children: MAIN }),
    );

    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Tabs — Home"');
    expect(html).toContain('<svg');
  });

  it('renders the current place, truncated with its full value in title', () => {
    const long = 'A very long group name that will not fit in a slim top bar';
    const html = render(
      createElement(AppShell, { place: long, viewer: { displayName: 'Ada' }, children: MAIN }),
    );

    expect(html).toContain('truncate');
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain(long);
  });

  it('shows a placeholder place while a screen does not know it yet, and none at all otherwise', () => {
    const loading = render(createElement(AppShell, { place: null, children: MAIN }));
    // The bar is the same height either way: a boundary paints before the guard has named the
    // group, and the block stands where the name will land.
    expect(loading).toContain('bg-muted/20');
    expect(loading).not.toContain('title=');

    const placeless = render(createElement(AppShell, { viewer: { displayName: 'Ada' }, children: MAIN }));
    expect(placeless).not.toContain('bg-muted/20');
  });

  it('emits no heading of its own', () => {
    const html = render(
      createElement(AppShell, { place: 'Home', viewer: { displayName: 'Ada' }, children: MAIN }),
    );

    // The page owns its h1. A shell that printed one would make every screen in the product
    // either two h1s or none.
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<h2');
    expect(html).toContain('content');
  });
});

describe('the account menu', () => {
  it('announces itself as a menu and starts closed', () => {
    const html = render(
      createElement(AppShell, { place: 'Home', viewer: { displayName: 'Ada' }, children: MAIN }),
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Account menu for Ada"');
    // Closed on the server, which is the state a cold load paints.
    expect(html).not.toContain('role="menu"');
  });

  it('falls back to a nameless label before the session has been read', () => {
    const html = render(createElement(AppShell, { place: null, children: MAIN }));
    expect(html).toContain('aria-label="Account menu"');
  });

  it('exposes Profile and Sign out as menu items', () => {
    const html = render(
      createElement(AccountMenuPanel, {
        displayName: 'Ada Lovelace',
        menuId: 'account-menu',
        onClose: () => {},
      }),
    );

    expect(html).toContain('id="account-menu"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Account"');
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(2);

    expect(html).toContain('href="/profile"');
    // Sign out posts the action — clearing the cookie and redirecting is a navigation only the
    // server can make — so it is a submit button inside a form, not a link.
    expect(/<form[^>]*>.{0,400}?Sign out/s.test(html)).toBe(true);
    expect(html).toContain('type="submit"');
  });

  it('closes on Escape and moves with the arrow keys', () => {
    expect(menuKeyIntent('Escape')).toBe('close');
    // Every other key belongs to the browser, or the menu would swallow Tab and Enter.
    expect(menuKeyIntent('ArrowDown')).toBeNull();
    expect(menuKeyIntent('Tab')).toBeNull();

    expect(stepMenuItem(0, 'ArrowDown', 2)).toBe(1);
    expect(stepMenuItem(1, 'ArrowDown', 2)).toBe(0);
    expect(stepMenuItem(0, 'ArrowUp', 2)).toBe(1);
    expect(stepMenuItem(1, 'Home', 2)).toBe(0);
    expect(stepMenuItem(0, 'End', 2)).toBe(1);
    expect(stepMenuItem(0, 'Escape', 2)).toBeNull();
  });
});
