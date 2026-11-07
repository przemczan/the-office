import { Link } from "@tanstack/react-router";
import { Avatar } from "@the-office/ui";
import type { ReactNode } from "react";
import { PersonAvatar } from "./person-avatar.tsx";

/** A person by avatar and name, leading to their page. */
export function PersonTag({
  roleKey,
  name,
  label = name,
}: {
  readonly roleKey: string;
  readonly name: string;
  /** What to call them, when it is more than their name. */
  readonly label?: string;
}): ReactNode {
  return (
    <Link className="person-tag" to="/people/$roleKey" params={{ roleKey }}>
      <span aria-hidden="true">
        <PersonAvatar roleKey={roleKey} name={name} size="xs" />
      </span>
      <span className="person-tag-name">{label}</span>
    </Link>
  );
}

/** The user or The Office, drawn as a person is, with no page to lead to. */
export function NamedTag({ name }: { readonly name: string }): ReactNode {
  return (
    <span className="person-tag">
      <span aria-hidden="true">
        <Avatar name={name} size="xs" />
      </span>
      <span className="person-tag-name">{name}</span>
    </span>
  );
}
