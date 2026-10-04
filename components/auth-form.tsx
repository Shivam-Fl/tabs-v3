'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { IDLE_AUTH_STATE, type AuthFormState } from '../lib/auth/validation';

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
 * rendered inline under the field they came from.
 */

export type AuthAction = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

export interface AuthFormProps {
  mode: 'signup' | 'signin';
  action: AuthAction;
  submitLabel: string;
  pendingLabel: string;
}

const INPUT_CLASSES =
  'min-h-11 w-full rounded-token border border-muted/40 bg-surface px-3 text-ink placeholder:text-muted';

const LABEL_CLASSES = 'text-sm font-medium';

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
      className="flex flex-col gap-4 rounded-token border border-muted/20 bg-surface p-5"
    >
      {state.status === 'error' && state.message !== '' && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      {state.status === 'success' ? (
        <p role="status" className="text-sm text-lent">
          {state.message}
        </p>
      ) : null}

      {mode === 'signup' ? (
        <div className="flex flex-col gap-2">
          <label className={LABEL_CLASSES} htmlFor={ids.displayName}>
            Display name
          </label>
          <input
            id={ids.displayName}
            name="displayName"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={fieldErrors.displayName !== undefined}
            aria-describedby={fieldErrors.displayName ? `${ids.displayName}-error` : undefined}
            className={INPUT_CLASSES}
          />
          {fieldErrors.displayName ? (
            <p id={`${ids.displayName}-error`} className="text-sm text-danger">
              {fieldErrors.displayName}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor={ids.email}>
          Email
        </label>
        <input
          id={ids.email}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldErrors.email !== undefined}
          aria-describedby={fieldErrors.email ? `${ids.email}-error` : undefined}
          className={INPUT_CLASSES}
        />
        {fieldErrors.email ? (
          <p id={`${ids.email}-error`} className="text-sm text-danger">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label className={LABEL_CLASSES} htmlFor={ids.password}>
          Password
        </label>
        <div className="flex gap-2">
          <input
            id={ids.password}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={fieldErrors.password !== undefined}
            aria-describedby={fieldErrors.password ? `${ids.password}-error` : undefined}
            className={INPUT_CLASSES}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-controls={ids.password}
            className="min-h-11 shrink-0 rounded-token border border-muted/40 px-3 text-sm font-medium"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {fieldErrors.password ? (
          <p id={`${ids.password}-error`} className="text-sm text-danger">
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="min-h-11 rounded-token bg-accent px-4 font-medium text-surface disabled:opacity-60"
      >
        {isPending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
