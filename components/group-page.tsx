'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { ArchiveGroupForm, RenameGroupForm } from './groups-panels';
import { Button } from './ui';
import { Dialog } from './ui-interactive';

/**
 * The one piece of the group page that needs a browser (IAC-2).
 *
 * Group settings used to sit at the bottom of the main scroll. ui.md moves them behind an entry
 * that opens them, and an entry that opens is state — so this is an island and everything else on
 * that screen is server-rendered markup.
 *
 * The row overflow menu is deliberately not here any more: it is `components/expense-row-menu.tsx`,
 * built on the `Menu` primitive in `ui-interactive.tsx` that the shell's account menu and the
 * settle panels share. A second, hand-rolled copy of that control lived here first, and two
 * implementations of one menu is one too many.
 *
 * Timestamps are deliberately not here either. They need a clock, not interaction, and they are
 * shared with the activity feed and `/activity`; a component that three screens render lives in its
 * own neutral module (`components/timestamp.tsx`) rather than in this one, which belongs to one page.
 */

/**
 * Group settings, behind one entry in the header (IAC-2).
 *
 * Rename and archive used to be a section at the bottom of the main scroll, which made the two
 * rarest actions on the screen the last thing on it and put a destructive one under a thumb
 * travelling past it. They are unchanged inside the dialog — `RenameGroupForm` and
 * `ArchiveGroupForm` are the same components the members page and this page already used — and
 * the members link comes along because "who is in this group" is the question somebody opening
 * settings usually has next.
 *
 * Owner-only and never rendered for an archived group: an archived group cannot be renamed or
 * archived again, and the page does not render this at all in that case. A button whose only
 * outcome is a refusal is not a courtesy.
 */
export function GroupSettingsEntry({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Settings aria-hidden="true" className="size-4" />
        Settings
      </Button>

      <Dialog open={open} title="Group settings" variant="sheet" onClose={() => setOpen(false)}>
        <RenameGroupForm groupId={groupId} name={groupName} />
        <ArchiveGroupForm groupId={groupId} groupName={groupName} />
        <Link
          className="text-secondary font-medium text-accent underline-offset-4 hover:underline"
          href={`/groups/${groupId}/members`}
        >
          Members and invite link
        </Link>
      </Dialog>
    </>
  );
}
