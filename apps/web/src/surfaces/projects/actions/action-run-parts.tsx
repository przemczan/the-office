import type { Action, ActionRun, Project } from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useSignedInUserId } from "../../../shell/use-user-name.ts";
import { isRunning, NOT_RUN_YET, runningAlreadyWords, runStateWords } from "./action-run-words.ts";
import { NEEDS_RUN_ENVIRONMENT_TO_RUN, needsRunEnvironmentToRun } from "./action-words.ts";

/**
 * A run's state badge (screens/project-page.md, "The Actions list"): Running, Succeeded, Failed
 * with why on hover, or Stopped; a Test target run's test instance's state; a Workflow run's
 * Starting, then its CI run's status as Work › CI shows it. "Not run yet" with no run.
 */
export function ActionRunStateBadge({ run }: { readonly run: ActionRun | undefined }): ReactNode {
  if (run === undefined) return <span className="action-not-run">{NOT_RUN_YET}</span>;
  const words = runStateWords(run);
  return (
    <span className="action-run-state" title={words.title === "" ? undefined : words.title}>
      <Badge size="sm" tone={words.tone} dot={run.status.kind === "workflow" && !words.spinning}>
        {words.spinning && (
          <span className="action-run-spinner" aria-hidden="true">
            <Icon name="loader-circle" size={11} />
          </span>
        )}
        {words.label}
      </Badge>
    </span>
  );
}

/**
 * Run, which opens the Run window; disabled while the last run runs, saying who started it and
 * when, and while its device needs Run environment On.
 */
export function RunActionButton({
  action,
  runEnvironment,
  lastRun,
  onRun,
  size = "sm",
}: {
  readonly action: Action;
  readonly runEnvironment: Project["runEnvironment"];
  readonly lastRun: ActionRun | undefined;
  readonly onRun: () => void;
  readonly size?: "sm" | "md";
}): ReactNode {
  const signedInUserId = useSignedInUserId();
  const running = lastRun !== undefined && isRunning(lastRun);
  const why = running
    ? runningAlreadyWords(action.name, lastRun, signedInUserId)
    : needsRunEnvironmentToRun(action, runEnvironment)
      ? NEEDS_RUN_ENVIRONMENT_TO_RUN
      : undefined;
  return (
    <span className="action-run-button" title={why}>
      <Button
        size={size}
        variant="secondary"
        iconLeft={<Icon name="play" size={14} />}
        disabled={why !== undefined}
        aria-label={`Run ${action.name}`}
        onClick={onRun}
      >
        Run
      </Button>
    </span>
  );
}
