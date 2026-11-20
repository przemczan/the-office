import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CheckState,
  CommandCheck,
  EnvironmentCheck,
  InstallCheck,
  Project,
  WorktreeCheck,
} from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { projectQueries, startEnvironmentCheck } from "../../api/projects.ts";
import {
  checkBadge,
  commandCheckLabel,
  runSummary,
  worktreeCheckDetail,
  worktreeCheckLabel,
} from "./environment-labels.ts";
import { ProjectBlock } from "./project-block.tsx";

const STATE_ICONS: Readonly<Record<CheckState, string>> = {
  waiting: "circle-dashed",
  running: "loader-circle",
  passed: "circle-check",
  failed: "circle-x",
  skipped: "circle-minus",
};

const STATE_LABELS: Readonly<Record<CheckState, string>> = {
  waiting: "Waiting",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * The environment check (spec §5.5): the Project's saved environment tried in a fresh worktree of
 * the base branch, install and then each of the Project's commands. It changes nothing.
 */
export function EnvironmentCheckBlock({ project }: { readonly project: Project }): ReactNode {
  const check = useQuery(projectQueries.environmentCheck(project.id));
  const badge = checkBadge(check.data);
  const queryClient = useQueryClient();
  const starting = useMutation({
    mutationFn: () => startEnvironmentCheck(project.id),
    onSuccess: (started) => {
      queryClient.setQueryData(projectQueries.environmentCheck(project.id).queryKey, {
        check: started,
      });
    },
  });
  const running = check.data?.state === "running";
  const reasons =
    starting.error instanceof ApiError
      ? starting.error.reasons
      : starting.error
        ? [starting.error.message]
        : [];
  return (
    <ProjectBlock
      icon="list-checks"
      title="Environment check"
      actions={
        check.data !== undefined && (
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
        )
      }
      note={`Tries the saved environment in a fresh worktree of ${project.baseBranch}: install, then each of the Project's commands. It changes nothing.`}
    >
      {check.error && (
        <p className="project-block-error" role="alert">
          {check.error.message}
        </p>
      )}
      {check.data === null && (
        <p className="project-block-text environment-unchecked">Not checked yet.</p>
      )}
      {check.data && <Checks check={check.data} project={project} />}
      {reasons.length > 0 && (
        <ul className="environment-reasons" role="alert">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {check.data !== undefined && (
        <div className="environment-actions">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Icon name="play" size={14} />}
            loading={starting.isPending || running}
            onClick={() => starting.mutate()}
          >
            {running ? "Checking…" : "Run the environment check"}
          </Button>
        </div>
      )}
    </ProjectBlock>
  );
}

function Checks({
  check,
  project,
}: {
  readonly check: EnvironmentCheck;
  readonly project: Project;
}): ReactNode {
  return (
    <ul className="environment-checks" aria-label="Environment checks">
      {check.checks.map((each) =>
        each.step === "worktree" ? (
          <WorktreeCheckLine key={each.step} check={each} project={project} />
        ) : (
          <CommandCheckLine
            key={each.step === "command" ? `command:${each.key}` : each.step}
            check={each}
          />
        ),
      )}
    </ul>
  );
}

function WorktreeCheckLine({
  check,
  project,
}: {
  readonly check: WorktreeCheck;
  readonly project: Project;
}): ReactNode {
  const detail = worktreeCheckDetail(check);
  return (
    <li className={`environment-check ${check.state}`}>
      <CheckIcon state={check.state} />
      <span className="environment-check-label">{worktreeCheckLabel(check, project)}</span>
      {detail !== undefined && (
        <span className="environment-check-meta">
          <span className="environment-check-detail">{detail}</span>
        </span>
      )}
    </li>
  );
}

function CommandCheckLine({ check }: { readonly check: InstallCheck | CommandCheck }): ReactNode {
  const outputId = useId();
  // A failed check shows its output until the user hides it.
  const [toggled, setToggled] = useState<boolean>();
  const showingOutput = toggled ?? check.state === "failed";
  const output = check.run?.output ?? "";
  return (
    <li className={`environment-check ${check.state}`}>
      <CheckIcon state={check.state} />
      <span className="environment-check-label">
        {commandCheckLabel(check)}
        {check.commandLine === "" ? (
          <span className="environment-check-detail">Not set</span>
        ) : (
          <code className="environment-check-command">{check.commandLine}</code>
        )}
      </span>
      {(check.run || output !== "") && (
        <span className="environment-check-meta">
          {check.run && <span className="environment-check-detail">{runSummary(check.run)}</span>}
          {output !== "" && (
            <button
              type="button"
              className="environment-check-toggle"
              aria-expanded={showingOutput}
              aria-controls={outputId}
              onClick={() => setToggled(!showingOutput)}
            >
              {showingOutput ? "Hide the output" : "Show the output"}
            </button>
          )}
        </span>
      )}
      {output !== "" && showingOutput && (
        <pre id={outputId} className="environment-check-output" aria-label="Output">
          {output}
        </pre>
      )}
    </li>
  );
}

function CheckIcon({ state }: { readonly state: CheckState }): ReactNode {
  return (
    <span className="environment-check-icon" role="img" aria-label={STATE_LABELS[state]}>
      <Icon name={STATE_ICONS[state]} size={15} />
    </span>
  );
}
