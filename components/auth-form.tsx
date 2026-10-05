'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { IDLE_AUTH_STATE, PASSWORD_MIN_LENGTH, type AuthFormState } from '../lib/auth/validation';
import { Button, TextInput } from './ui';

/**
 * The one client island in auth. It exists for exactly the things a server-rendered form
 * cannot do:
 *
 * - **Preserved input.** The fields are controlled, so a submit that comes back with an error
 *   leaves what the user typed where it was. A native form would have been re-rendered from
 *   the server's empty state and cleared it.
 * - **A pending submit that cannot be double-clicked.** `isPending` disables the button and
 *   the submit handler drops a second submission while one is in flight.
 * - **The show/hide password toggle**, which is a keystroke-level concern.
 *
 * Validation is not duplicated here: the server action owns it, and the errors it returns are
 * rendered inline under the field they came from. The password *hint* is not validation either —
 * it states the rule before it is broken, which is the one thing ui.md asks a sign-up screen to
 * say up front, and it reads the rule from lib/auth/validation rather than restating it.
 */

export type AuthAction = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

export interface AuthFormProps {
  mode: 'signup' | 'signin';
  action: AuthAction;
  submitLabel: string;
  pendingLabel: string;
}

export function AuthForm({ mode, action, submitLabel, pendingLabel }: AuthFormProps) {
  const [state, formAction, isPending] = useActionState(action, IDLE_AUTH_STATE);
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const fieldErrors = state.fieldErrors ?? {};
  const ids = {
    displayName: `${mode}-displayName`,
    email: `${mode}-email`,
    password: `${mode}-password`,
  };

  // Both actions answer success the same way for a fresh and an existing address, so the
  // island cannot branch on the response — it refreshes, and the page itself decides whether
  // a session now exists and where that leads.
  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (isPending) event.preventDefault();
      }}
      className="flex flex-col gap-4 rounded-token border border-border bg-surface p-5 shadow-sm"
    >
      {state.status === 'error' && state.message !== '' && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="text-secondary text-danger">
          {state.message}
        </p>
      ) : null}

      {state.status === 'success' ? (
        <p role="status" className="text-secondary text-lent">
          {state.message}
        </p>
      ) : null}

      {mode === 'signup' ? (
        <TextInput
          id={ids.displayName}
          name="displayName"
          label="Display name"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.displayName}
        />
      ) : null}

      <TextInput
        id={ids.email}
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />

      <TextInput
        id={ids.password}
        name="password"
        label="Password"
        type={showPassword ? 'text' : 'password'}
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        hint={mode === 'signup' ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-controls={ids.password}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-token border border-border bg-surface px-3 text-body font-medium text-ink hover:bg-surface-sunken"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" className="size-5" />
            ) : (
              <Eye aria-hidden="true" className="size-5" />
            )}
            {showPassword ? 'Hide' : 'Show'}
          </button>
        }
      />

      <Button type="submit" pending={isPending} pendingLabel={pendingLabel}>
        {submitLabel}
      </Button>
    </form>
  );
}
