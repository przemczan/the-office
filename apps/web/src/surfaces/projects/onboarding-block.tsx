import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { OnboardingState, Project, ProjectOnboarding } from "@the-office/contracts";
import { Badge } from "@the-office/ui";
import type { ReactNode } from "react";
import { onboardingsQuery, taskQueries } from "../../api/work.ts";
import { TASK_STATE_NAMES } from "../../shell/work/work-words.ts";
import { ProjectBlock } from "./project-block.tsx";

const ONBOARDING_BADGES: Readonly<
  Record<OnboardingState, { readonly label: string; readonly tone: "info" | "success" }>
> = {
  onboarding: { label: "Onboarding", tone: "info" },
  onboarded: { label: "Onboarded", tone: "success" },
};

/** The Project's onboarding, from its Onboard Task; undefined while loading or when it has none. */
export function useOnboarding(projectId: string): ProjectOnboarding | undefined {
  const onboardings = useQuery(onboardingsQuery()).data;
  return onboardings?.find((onboarding) => onboarding.projectId === projectId);
}

/** "Onboarding" or "Onboarded"; nothing for a Project without an Onboard Task. */
export function OnboardingBadge({ projectId }: { readonly projectId: string }): ReactNode {
  const onboarding = useOnboarding(projectId);
  if (!onboarding) return null;
  const { label, tone } = ONBOARDING_BADGES[onboarding.state];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/** The Project's onboarding and the Onboard Task it comes from (spec §2.1 Defaults). */
export function OnboardingBlock({ project }: { readonly project: Project }): ReactNode {
  const onboarding = useOnboarding(project.id);
  return (
    <ProjectBlock
      icon="hard-drive"
      title="Onboarding"
      actions={<OnboardingBadge projectId={project.id} />}
    >
      {onboarding ? (
        <OnboardTaskLine taskId={onboarding.taskId} />
      ) : (
        <p className="project-block-note">
          None: the Project has no Onboard Task. Devops onboards a Project they are asked to add.
        </p>
      )}
    </ProjectBlock>
  );
}

function OnboardTaskLine({ taskId }: { readonly taskId: string }): ReactNode {
  const task = useQuery(taskQueries.one(taskId)).data;
  if (!task) return null;
  return (
    <p className="project-block-note">
      From the Task{" "}
      <Link to="/tasks/$taskId" params={{ taskId }}>
        {task.title}
      </Link>{" "}
      · {TASK_STATE_NAMES[task.state]}
      {task.state === "ready" && ", waiting for your Start"}
    </p>
  );
}
