import { Link } from "@tanstack/react-router";
import type { OfficeActionProposalSubject, Proposal } from "@the-office/contracts";
import type { ReactNode } from "react";
import { ChangedFields } from "./changed-fields.tsx";

export type OfficeActionChange = Extract<Proposal["change"], { kind: "office-action" }>;

/** The record the Proposal changes, as a link to its page when its kind has one. */
export function SubjectLink({
  subject,
}: {
  readonly subject: OfficeActionProposalSubject;
}): ReactNode {
  const { kind, id, title } = subject;
  switch (kind) {
    case "task":
      return (
        <Link className="proposal-link" to="/tasks/$taskId" params={{ taskId: id }}>
          {title}
        </Link>
      );
    case "initiative":
      return (
        <Link
          className="proposal-link"
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: id }}
        >
          {title}
        </Link>
      );
    case "idea":
      return (
        <Link className="proposal-link" to="/work/ideas" search={{ idea: id }}>
          {title}
        </Link>
      );
    case "project":
      return (
        <Link className="proposal-link" to="/projects/$projectId" params={{ projectId: id }}>
          {title}
        </Link>
      );
    default:
      return <span>{title}</span>;
  }
}

/** What an Office action's Proposal changes: its subject and each changed field. */
export function OfficeActionBody({ change }: { readonly change: OfficeActionChange }): ReactNode {
  return (
    <>
      <div className="proposal-foot">
        <span className="proposal-note">
          On <SubjectLink subject={change.subject} />
        </span>
      </div>
      <ChangedFields fields={change.fields} />
    </>
  );
}
