import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** A started Stage's lock, with why, such as "Done: started, so it can't be changed". */
export function FlowLock({ note }: { readonly note: string }): ReactNode {
  return (
    <span className="flow-lock" role="img" aria-label={note} title={note}>
      <Icon name="lock" size={11} />
    </span>
  );
}

/** Over a locked Stage's or route's panel: the lock and why. */
export function FlowLockedNote({ note }: { readonly note: string }): ReactNode {
  return (
    <p className="flow-panel-hint flow-locked-note">
      <Icon name="lock" size={12} />
      {note}
    </p>
  );
}

/** The fields as they are, each disabled with why when `note` says they are locked. */
export function FlowLockedFields({
  note,
  children,
}: {
  readonly note: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  if (note === undefined) return children;
  return (
    <fieldset className="flow-locked-fields" disabled title={note}>
      {children}
    </fieldset>
  );
}

/**
 * An IconButton's tooltip on a locked Stage: why, in place of its label, which it shows as its
 * tooltip otherwise (an undefined title would take that away).
 */
export function lockedTitle(note: string | undefined): { readonly title?: string } {
  return note === undefined ? {} : { title: note };
}
