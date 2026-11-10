import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { OpenPage } from "@the-office/contracts";
import type { ReactNode } from "react";
import { roleQueries } from "../api/people.ts";
import { projectQueries } from "../api/projects.ts";
import { MENTION_KINDS } from "./mentions/mention-words.ts";
import { PersonAvatar } from "./person-avatar.tsx";
import { roleName } from "./person-name.ts";
import { ProjectMark } from "./project-mark.tsx";
import { RecordMention } from "./record-mention.tsx";
import "./record-mention.css";

/**
 * The Open page's record (spec §2.4) as a chip leading to its page, named as the record is now: a
 * Task, Initiative or Idea as a Mention shows it, a person by their avatar and a Project by its mark.
 */
export function OpenPageChip({ page }: { readonly page: OpenPage }): ReactNode {
  switch (page.kind) {
    case "task":
    case "initiative":
    case "idea":
      return <RecordMention link={page} written={MENTION_KINDS[page.kind].word} />;
    case "person":
      return <PersonChip roleKey={page.roleKey} />;
    case "project":
      return <ProjectPageChip projectId={page.projectId} />;
  }
}

function PersonChip({ roleKey }: { readonly roleKey: string }): ReactNode {
  const name = roleName(roleKey, useQuery(roleQueries.list()).data);
  return (
    <Link className="record-mention" to="/people/$roleKey" params={{ roleKey }} title="Person">
      <span aria-hidden="true">
        <PersonAvatar roleKey={roleKey} name={name} size="xs" />
      </span>
      {name}
    </Link>
  );
}

function ProjectPageChip({ projectId }: { readonly projectId: string }): ReactNode {
  const project = useQuery(projectQueries.one(projectId)).data;
  return (
    <Link
      className="record-mention"
      to="/projects/$projectId"
      params={{ projectId }}
      title="Project"
    >
      {project && <ProjectMark project={project} />}
      {project?.name ?? projectId}
    </Link>
  );
}
