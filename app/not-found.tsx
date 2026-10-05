import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Not found · Tabs' };

/**
 * The one 404 the product has (TR-3, TR-11).
 *
 * Group routes reach it from `notFound()` and nothing distinguishes why: a group that does not
 * exist, one the caller does not belong to, a malformed id and an expired invite link all
 * render this page, byte for byte. That is the point — a screen that said "you are not a member"
 * would be a screen that told a stranger the group is real.
 *
 * It carries one recovery action, because a dead end is not a designed error state.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">That page is not available</h1>
      <p className="text-muted">
        The link may be wrong, or whatever it pointed at is gone or no longer yours to open.
      </p>
      <p>
        <Link className="text-accent underline" href="/">
          Back to your groups
        </Link>
      </p>
    </main>
  );
}
