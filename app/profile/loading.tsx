import { AppShell } from '../../components/app-shell';
import { Skeleton } from '../../components/ui';

/**
 * What a cold navigation to the profile paints (TR-11, AC-7).
 *
 * The page cannot render anything before its session read has come back, so without this the
 * route paints blank and then fills in. This is the boundary Next streams in the meantime, and
 * its blocks are the settings card's own shape — a title, then the two fields and the button —
 * so nothing moves when the data arrives.
 *
 * It holds no data and reads none, which is what makes it safe to paint before the session has
 * been checked at all. The shell goes above the skeletons so the bar is already there when the
 * data lands; its place — Profile — is a constant this route already knows.
 */
export default function ProfileLoading() {
  return (
    <AppShell place="Profile">
      <main
        className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-5 px-4 py-5"
        aria-busy="true"
      >
        <p role="status" className="sr-only">
          Loading profile…
        </p>

        <div data-skeleton="title">
          <Skeleton className="h-8 w-40" />
        </div>

        <section className="flex flex-col gap-4 rounded-token border border-border bg-surface p-4 shadow-sm">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-11 w-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-11 w-32" />
        </section>
      </main>
    </AppShell>
  );
}
