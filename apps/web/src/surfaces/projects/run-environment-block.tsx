import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  OffBoardTask,
  Project,
  ProjectRunEnvironment,
  RunEnvironmentChange,
  RunEnvironmentDefinition,
  RunEnvironmentSetUpAnswer,
} from "@the-office/contracts";
import { Alert, Badge, Button, Icon, SegmentedControl } from "@the-office/ui";
import type { ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { offBoardTaskQueries } from "../../api/off-board-tasks.ts";
import { changeRunEnvironment, projectQueries, setUpRunEnvironment } from "../../api/projects.ts";
import { TASKS } from "../../api/work.ts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { settingChosenWords, setUpWords } from "../../shell/run-environment-words.ts";
import { momentWords } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { OffBoardTaskStatus, StartRefusal } from "./off-board-task-status.tsx";
import { ProjectBlock } from "./project-block.tsx";
import { SetUpTaskLine } from "./set-up-task-line.tsx";

const DEFINITION_BADGES: Readonly<
  Record<
    RunEnvironmentDefinition["state"],
    { readonly label: string; readonly tone: "neutral" | "success" | "warning" }
  >
> = {
  "not-found": { label: "Not found", tone: "neutral" },
  valid: { label: "Valid", tone: "success" },
  "not-valid": { label: "Not valid", tone: "warning" },
};

const SETTING_OPTIONS = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const;

/**
 * Whether the Project's checks run in its run environment, the repository's .devcontainer/ on the
 * base branch, and setting one up.
 */
export function RunEnvironmentBlock({ project }: { readonly project: Project }): ReactNode {
  const runEnvironment = useQuery(projectQueries.runEnvironment(project.id));
  const offBoard = useQuery(offBoardTaskQueries.ofProject(project.id));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const keep = (saved: ProjectRunEnvironment): void => {
    queryClient.setQueryData(projectQueries.runEnvironment(project.id).queryKey, saved);
    void queryClient.invalidateQueries({ queryKey: projectQueries.one(project.id).queryKey });
  };
  const choosing = useMutation({
    mutationFn: (setting: RunEnvironmentChange["runEnvironment"]) =>
      changeRunEnvironment(project.id, setting),
    onSuccess: (saved) => {
      keep(saved);
      showToast(settingChosenWords(saved, project.name));
    },
  });
  const settingUp = useMutation({
    mutationFn: () => setUpRunEnvironment(project.id),
    onSuccess: (answer: RunEnvironmentSetUpAnswer) => {
      keep(answer.runEnvironment);
      // The Off-board Tasks sit under the Tasks' key.
      if (answer.start) void queryClient.invalidateQueries({ queryKey: TASKS });
      const words = setUpWords(answer, project.name);
      if (words !== undefined) showToast(words);
    },
  });
  const data = runEnvironment.data;
  // One action's refusal shows until the next action, so the other's never shows as its own.
  const choose = (setting: RunEnvironmentChange["runEnvironment"]): void => {
    settingUp.reset();
    choosing.mutate(setting);
  };
  const setUp = (): void => {
    choosing.reset();
    settingUp.mutate();
  };
  const failure = choosing.error ?? settingUp.error ?? runEnvironment.error;
  const start = settingUp.data?.start;
  const refused = start?.outcome === "refused" ? start.reasons : undefined;
  return (
    <ProjectBlock
      icon="container"
      title="Run environment"
      actions={data?.runEnvironment === "not-decided" && <Badge>Not decided yet</Badge>}
    >
      <p className="project-block-text">
        With Run environment On, the Project's checks run in the containers its .devcontainer/
        defines; until then they run on this computer.
      </p>
      {data && (
        <>
          <div className="project-row">
            <span className="project-row-label">Run environment</span>
            <div role="group" aria-label="Run environment">
              <SegmentedControl
                size="sm"
                options={SETTING_OPTIONS.map((option) => ({ ...option }))}
                value={data.runEnvironment}
                onChange={(setting) => {
                  if (setting === "on" || setting === "off") choose(setting);
                }}
              />
            </div>
          </div>
          <DefinitionRow definition={data.definition} baseBranch={project.baseBranch} />
          {data.setUpProblems.length > 0 && (
            <div className="run-environment-problems">
              <p className="project-block-text">
                The last Off-board Task was Done, but the .devcontainer/ on its branch isn't valid,
                so Run environment stayed as it was:
              </p>
              <Problems problems={data.setUpProblems} />
            </div>
          )}
          <SetUp
            project={project}
            runEnvironment={data}
            setUpTask={offBoard.data?.runEnvironmentSetUp ?? null}
            pending={settingUp.isPending}
            onSetUp={setUp}
          />
        </>
      )}
      {refused && <StartRefusal title="Nothing was set up" reasons={refused} />}
      {failure && <Refusal error={failure} />}
    </ProjectBlock>
  );
}

function DefinitionRow({
  definition,
  baseBranch,
}: {
  readonly definition: RunEnvironmentDefinition;
  readonly baseBranch: string;
}): ReactNode {
  const { label, tone } = DEFINITION_BADGES[definition.state];
  return (
    <>
      <div className="project-row">
        <span className="project-row-label">.devcontainer/</span>
        <Badge tone={tone} dot>
          {label}
        </Badge>
        <span className="project-block-note run-environment-where">
          on {baseBranch}, as last fetched
        </span>
      </div>
      {definition.state === "not-valid" && <Problems problems={definition.problems} />}
    </>
  );
}

/**
 * The "Set up the run environment" Off-board Task while it is in flight, in place of the button;
 * once it is Done with Run environment On and valid, the line that says so; otherwise Set up run
 * environment, unless it is On with a valid definition.
 */
function SetUp({
  project,
  runEnvironment,
  setUpTask,
  pending,
  onSetUp,
}: {
  readonly project: Project;
  readonly runEnvironment: ProjectRunEnvironment;
  readonly setUpTask: OffBoardTask | null;
  readonly pending: boolean;
  readonly onSetUp: () => void;
}): ReactNode {
  const state = setUpTask?.status.state;
  if (setUpTask && state !== "done" && state !== "dropped") {
    return (
      <OffBoardTaskStatus task={setUpTask}>
        {(state === "queued" || state === "running") && (
          <p className="off-board-task-hint">Run environment turns On when it is Done.</p>
        )}
      </OffBoardTaskStatus>
    );
  }
  // An open set-up Task the Off-board Tasks' read doesn't show yet.
  if (runEnvironment.setUpTask) {
    return (
      <SetUpTaskLine task={runEnvironment.setUpTask}>
        Run environment turns On when it is Done.
      </SetUpTaskLine>
    );
  }
  if (runEnvironment.runEnvironment === "on" && runEnvironment.definition.state === "valid") {
    return setUpTask?.status.state === "done" ? (
      <DoneLine project={project} task={setUpTask} endedAt={setUpTask.status.endedAt} />
    ) : null;
  }
  return (
    <div className="run-environment-actions">
      <Button
        variant="secondary"
        size="sm"
        iconLeft={<Icon name="wrench" size={14} />}
        loading={pending}
        onClick={onSetUp}
      >
        Set up run environment
      </Button>
      <span className="project-block-note">
        With a valid .devcontainer/ on the base branch it turns On at once; otherwise Devops writes
        one in an Off-board Task that starts now.
      </span>
    </div>
  );
}

/** "Run environment is On", and the Off-board Task that set it up. */
function DoneLine({
  project,
  task,
  endedAt,
}: {
  readonly project: Project;
  readonly task: OffBoardTask;
  readonly endedAt: string | null;
}): ReactNode {
  return (
    <div className="run-environment-done">
      <Alert
        tone="success"
        title={`Run environment is On: ${project.name}'s .devcontainer/ is valid.`}
      />
      <p className="off-board-task-meta">
        <span>
          Set up in the Off-board Task{" "}
          <Link to="/tasks/$taskId" params={{ taskId: task.taskId }}>
            {task.title}
          </Link>
        </span>
        {endedAt !== null && <span>Done on {momentWords(endedAt)}</span>}
        <span>{tokensShort(task.tokens)} tokens</span>
      </p>
    </div>
  );
}

function Problems({ problems }: { readonly problems: readonly string[] }): ReactNode {
  return (
    <ul className="environment-reasons run-environment-problem-list">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}

function Refusal({ error }: { readonly error: Error }): ReactNode {
  const reasons = error instanceof ApiError ? error.reasons : [error.message];
  return (
    <ul className="environment-reasons run-environment-refusal" role="alert">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}
