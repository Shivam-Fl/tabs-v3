'use client';

import { useFormStatus } from 'react-dom';

/**
 * The profile form's Save button, and the only client island on that screen. It exists for one
 * reason: a plain server-action submit gives no feedback and accepts a second click while the
 * first request is still in flight, so a double-click fires two saves.
 *
 * `useFormStatus` reads the pending state of the enclosing `<form>`, which is why this has to
 * be rendered as a child of it rather than beside it. It deliberately does not replace the
 * form: `updateProfile` answers by redirect (`?saved=1` / `?error=invalid` / `/signin`), and
 * the notice flow that renders those stays on the server — the island only decides whether the
 * button is clickable and what it says.
 */
export function ProfileSaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="min-h-11 rounded-token bg-accent px-4 font-medium text-surface disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
