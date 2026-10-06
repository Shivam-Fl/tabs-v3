'use client';

import { ChevronDown } from 'lucide-react';
import { useActionState } from 'react';
import { updateProfile } from '../lib/auth/actions';
import {
  IDLE_PROFILE_STATE,
  SUPPORTED_CURRENCIES,
  profileFormDefaults,
  type ProfileNotice,
} from '../lib/auth/validation';
import { ProfileSaveButton } from './profile-save-button';
import { Card, FIELD_CLASSES, FIELD_LABEL_CLASSES, FieldError, TextInput } from './ui';

/**
 * The profile's settings card (AC-3, AC-5, AC-8, ui.md's Profile screen).
 *
 * It is an island because a refusal has to keep what the person typed: a server-rendered form
 * answered by a redirect unmounts on the way back and the field returns to its stored value,
 * which is exactly the "clears the input" ui.md forbids. Letting `updateProfile` answer with a
 * refusal rather than a redirect is the transport ADR-0008 already prescribes.
 *
 * **The card and the notice slot live in here rather than on the page (AC-3).** The notice is a
 * function of the action state as well as of the URL — a save that just landed shows its sentence
 * here, a submit that just came back refused shows nothing but its field errors, and only an idle
 * island shows the notice the page arrived with. A page that rendered the notice outside the
 * island could only ever show the URL's, which is how a stale `?saved=1` ended up sitting beside
 * fresh field errors. The markup is the page's markup unchanged: the slot above the card, one
 * `role="status"` node, and the same classes for the same tones.
 *
 * **Holding the values in controlled state seeded from the saved props is the bug this form used
 * to have (PR #44 BUG-1).** The props are what the database holds; a refusal renders from them,
 * so a select bound to `useState(currency)` repainted the *saved* currency and silently discarded
 * the one that was chosen — the name field only appeared to survive because its own state
 * happened to agree with the submission. The values this form shows therefore come from
 * `profileFormDefaults`, which prefers the submitted values the action echoes back on a refusal,
 * and the fields are uncontrolled: the form is keyed by those defaults, so a refusal that carries
 * new values rebuilds the field DOM from them rather than repainting anything. Idle renders read
 * the saved props exactly as before.
 *
 * The select is styled rather than left as the browser draws it: `appearance-none` removes the
 * native arrow and a lucide chevron sits inside the field in its place, which is ui.md's
 * "nothing default-browser" applied to the one control on this screen.
 */
export function ProfileForm({
  displayName,
  currency,
  email,
  notice = null,
}: {
  displayName: string;
  currency: string;
  email: string;
  /** The sentence the page's query carries, if any; the action's own answer replaces it. */
  notice?: ProfileNotice | null;
}) {
  const [state, formAction] = useActionState(updateProfile, IDLE_PROFILE_STATE);

  const errors = state.fieldErrors ?? {};
  // A refusal that names fields renders under those fields; the summary is for the one that
  // does not, so the sentence never appears twice on the page (conventions, PR #20 BUG-1).
  const summary =
    state.status === 'error' && Object.keys(errors).length === 0 ? state.message : null;

  // What the fields display, and the key the form remounts on: identical defaults (an idle
  // render, or a second refusal echoing the same values) leave the DOM — and the focus in it —
  // alone, while a refusal carrying something new re-seeds both fields from the submission.
  const defaults = profileFormDefaults(state, { displayName, currency });

  // One slot, and what it holds is decided by the newest thing that happened. A success this
  // island has just been handed says so; while the island holds a refusal the slot is empty,
  // because the refusal renders under the fields it is about and a saved sentence beside it would
  // be describing an outcome this submit did not have; and an idle screen — the state a cold page
  // load is in — shows whatever the URL carried.
  const banner: ProfileNotice | null =
    state.status === 'success'
      ? { tone: 'lent', text: state.message }
      : state.status === 'idle'
        ? notice
        : null;

  return (
    <>
      {banner ? (
        <p
          role={banner.tone === 'danger' ? 'alert' : 'status'}
          className={
            banner.tone === 'danger' ? 'text-secondary text-danger' : 'text-secondary text-lent'
          }
        >
          {banner.text}
        </p>
      ) : null}

      <Card>
        <p className="text-secondary text-ink-muted">{email}</p>

        <form
          key={JSON.stringify(defaults)}
          action={formAction}
          noValidate
          className="flex flex-col gap-4"
        >
          {summary ? (
            <p role="alert" className="text-secondary text-danger">
              {summary}
            </p>
          ) : null}

          <TextInput
            id="profile-displayName"
            name="displayName"
            label="Display name"
            autoComplete="name"
            maxLength={80}
            defaultValue={defaults.displayName}
            error={errors.displayName}
          />

          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES} htmlFor="profile-currency">
              Default currency
            </label>
            <div className="relative">
              <select
                id="profile-currency"
                name="currency"
                defaultValue={defaults.currency}
                aria-invalid={errors.currency !== undefined}
                aria-describedby={errors.currency ? 'profile-currency-error' : undefined}
                className={`${FIELD_CLASSES} appearance-none pr-10`}
              >
                {SUPPORTED_CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              {/* Decorative: the select's own value is what a screen reader reads, so the chevron
                  is the browser's arrow replaced, not a second label for the field. */}
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
              />
            </div>
            <p className="text-secondary text-ink-muted">New groups start in this currency.</p>
            <FieldError id="profile-currency-error" message={errors.currency} />
          </div>

          <ProfileSaveButton />
        </form>
      </Card>
    </>
  );
}
