import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  OffBoardTask,
  OffBoardTaskStart,
  OnboardingState,
  Project,
  ProjectOnboarding,
} from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { Fragment, type ReactNode } from "react";
import { offBoardTaskQueries, startOnboard } from "../../api/off-board-tasks.ts";
import { onboardingsQuery, TASKS } from "../../api/work.ts";
import { offBoardStartWords } from "../../shell/off-board-task-words.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { dayOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { OffBoardTaskStatus, StartRefusal } from "./off-board-task-status.tsx";
import { ProjectBlock } from "./project-block.tsx";

const ONBOARDING_BADGES: Readonly<
  Record<OnboardingState, { readonly label: string; readonly tone: "info" | "success" }>
> = {
  onboarding: { label: "Onboarding", tone: "info" },
  onboarded: { label: "Onboarded", tone: "success" },
};

/** The Project's onboarding, from its latest Onboard Task; undefined while loading or when it has none. */
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

/**
 * The Project's onboarding (spec §2.1 Defaults): Onboard while it never had an Onboard Task, its
 * latest one as an Off-board Task while in flight, Onboard again once that is Done or Dropped, and
 * the earlier ones under Onboarding history.
 */
export function OnboardingBlock({ project }: { readonly project: Project }): ReactNode {
  const offBoard = useQuery(offBoardTaskQueries.ofProject(project.id));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const onboarding = useMutation({
    mutationFn: () => startOnboard(project.id),
    onSuccess: (start: OffBoardTaskStart) => {
      // The Off-board Tasks and the onboardings both sit under the Tasks' key.
      void queryClient.invalidateQueries({ queryKey: TASKS });
      const words = offBoardStartWords(start, project.name);
      if (words !== undefined) showToast(words);
    },
  });
  const latest = offBoard.data?.onboard ?? null;
  const history = offBoard.data?.onboardHistory ?? [];
  const ended = latest !== null && isEnded(latest);
  const refused = onboarding.data?.outcome === "refused" ? onboarding.data.reasons : undefined;
  return (
    <ProjectBlock
      icon="hard-drive"
      title="Onboarding"
      actions={
        <>
          <OnboardingBadge projectId={project.id} />
          {offBoard.data && (latest === null || ended) && (
            <Button
              size="sm"
              variant={latest === null ? "primary" : "secondary"}
              iconLeft={<Icon name={latest === null ? "play" : "rotate-ccw"} size={14} />}
              loading={onboarding.isPending}
              onClick={() => onboarding.mutate()}
            >
              {latest === null ? "Onboard" : "Onboard again"}
            </Button>
          )}
        </>
      }
    >
      {refused && <StartRefusal title="Onboard didn't start" reasons={refused} />}
      {onboarding.error && <RefusalAlert title="Onboard didn't start" error={onboarding.error} />}
      {offBoard.error && (
        <RefusalAlert title="The onboarding can't be read" error={offBoard.error} />
      )}
      {offBoard.data && latest === null && (
        <>
          <p className="project-block-text">
            Not onboarded yet. Devops makes it build and test in a fresh worktree, asking before
            installing anything, then publishes the fixes.
          </p>
          <p className="project-block-note">
            Starts at once as an Off-board Task: no Start, not on the board. It waits Queued while
            the Project limit or the queue is full.
          </p>
        </>
      )}
      {latest && (
        <OffBoardTaskStatus task={latest}>
          {latest.status.state === "done" && (
            <p className="off-board-task-hint">
              Onboard again starts a new Onboard Task on the base branch as it is now, for when the
              toolchain or the commands have changed.
            </p>
          )}
          {latest.status.state === "dropped" && (
            <p className="off-board-task-hint">
              Not onboarded. Onboard again starts a new Onboard Task.
            </p>
          )}
        </OffBoardTaskStatus>
      )}
      {history.length > 0 && <OnboardingHistory history={history} />}
    </ProjectBlock>
  );
}

/** "Onboarding history: Onboard · Done 2 Oct · Onboard · Dropped 28 Sep", each to its Task page. */
function OnboardingHistory({ history }: { readonly history: readonly OffBoardTask[] }): ReactNode {
  return (
    <p className="onboarding-history">
      <span>Onboarding history:</span>
      {history.map((task, index) => (
        <Fragment key={task.taskId}>
          {index > 0 && <span aria-hidden="true">·</span>}
          <Link to="/tasks/$taskId" params={{ taskId: task.taskId }}>
            {historyWords(task)}
          </Link>
        </Fragment>
      ))}
    </p>
  );
}

function historyWords(task: OffBoardTask): string {
  const { status } = task;
  if (status.state === "done" || status.state === "dropped") {
    const state = status.state === "done" ? "Done" : "Dropped";
    return status.endedAt === null
      ? `${task.title} · ${state}`
      : `${task.title} · ${state} ${dayOf(status.endedAt)}`;
  }
  return task.title;
}

function isEnded(task: OffBoardTask): boolean {
  return task.status.state === "done" || task.status.state === "dropped";
}
