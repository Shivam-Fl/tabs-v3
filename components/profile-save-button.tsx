'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui';

/**
 * The profile form's Save button, and the reason it is its own island inside a client form.
 *
 * `useFormStatus` reads the pending state of the enclosing `<form>`, which is why this has to be
 * rendered as a child of it rather than beside it — and it is what makes a double submit
 * impossible: the button is disabled and says "Saving…" for the whole round trip, including the
 * second click of a fast double-click and a slow submit that has not come back yet (AC-5,
 * conventions: every form that acts gets a pending guard).
 *
 * It renders through the shared `Button` so the guard's markup — disabled, `aria-busy`, the
 * spinner beside a label rather than instead of one — is the same everywhere, while the button's
 * own label and pending label stay this screen's.
 */
export function ProfileSaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" pending={pending} pendingLabel="Saving…">
      Save
    </Button>
  );
}
