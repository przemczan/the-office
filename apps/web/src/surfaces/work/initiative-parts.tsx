import type { Initiative, Project, Role } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { ProjectChip } from "../../shell/project-chip.tsx";
import { INITIATIVE_STATE_TONES, initiativeStateName } from "./initiative-words.ts";

export function InitiativeStateBadge({
  initiative,
  shaper,
}: {
  readonly initiative: Initiative;
  readonly shaper: Role | undefined;
}): ReactNode {
  return (
    <Badge tone={INITIATIVE_STATE_TONES[initiative.state]} dot>
      {initiativeStateName(initiative.state, shaper?.card.name)}
    </Badge>
  );
}

/** The Projects of its Tasks, each once; none until its first Task. */
export function InitiativeProjects({
  initiative,
  projects,
}: {
  readonly initiative: Initiative;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  if (initiative.projectIds.length === 0) return <span>No Project yet</span>;
  return initiative.projectIds.map((projectId) => (
    <ProjectChip key={projectId} projectId={projectId} projects={projects} />
  ));
}
