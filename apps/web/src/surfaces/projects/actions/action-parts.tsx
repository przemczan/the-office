import { Link } from "@tanstack/react-router";
import type { Action, Project, TestTarget } from "@the-office/contracts";
import { Badge, Icon, IconButton, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { ACTION_KIND_LABELS, leavesTheWorkstationWords } from "../../../shell/action-words.ts";
import { NEEDS_RUN_ENVIRONMENT_TO_RUN, needsRunEnvironmentToRun } from "./action-words.ts";

/** Its kind with what it runs: "Project command · build", "Test target · Web app", "Workflow · release.yml". */
export function ActionRunsLine({
  action,
  targets,
}: {
  readonly action: Action;
  readonly targets: readonly TestTarget[] | undefined;
}): ReactNode {
  const kind = ACTION_KIND_LABELS[action.kind];
  switch (action.kind) {
    case "project-command":
      return (
        <>
          {kind} · <code>{action.settings.commandKey}</code>
        </>
      );
    case "test-target": {
      const { targetKey } = action.settings;
      return (
        <>
          {kind} · {targets?.find(({ key }) => key === targetKey)?.name ?? targetKey}
        </>
      );
    }
    case "workflow":
      return (
        <>
          {kind} · <code>{action.settings.file}</code>
        </>
      );
  }
}

/** The Leaves the workstation badge, its words on hover. */
export function LeavesTheWorkstationBadge({
  baseBranch,
}: {
  readonly baseBranch: string;
}): ReactNode {
  return (
    <Tooltip content={leavesTheWorkstationWords(baseBranch)} focusable>
      <Badge tone="warning" size="sm">
        Leaves the workstation
      </Badge>
    </Tooltip>
  );
}

/** Run, the pencil and the trash of an Action, in its row and on its open card. */
export function ActionTools({
  action,
  before,
  disabled,
  onChange,
  onRemove,
}: {
  readonly action: Action;
  /** What comes before the pencil, such as Run. */
  readonly before?: ReactNode;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly onRemove: () => void;
}): ReactNode {
  return (
    <span className="action-tools">
      {before}
      <IconButton
        icon={<Icon name="pencil" size={14} />}
        label={`Change ${action.name}`}
        size="sm"
        disabled={disabled}
        onClick={onChange}
      />
      <IconButton
        icon={<Icon name="trash-2" size={14} />}
        label={`Remove ${action.name}`}
        size="sm"
        disabled={disabled}
        onClick={onRemove}
      />
    </span>
  );
}

/**
 * The warnings on an Action whose settings name something gone, each with its mark, and its
 * device's need of Run environment On, with a link to it.
 */
export function ActionWarnings({
  project,
  action,
  warnings,
}: {
  readonly project: Pick<Project, "id" | "runEnvironment">;
  readonly action: Action;
  readonly warnings: readonly string[];
}): ReactNode {
  const needsOn = needsRunEnvironmentToRun(action, project.runEnvironment);
  if (warnings.length === 0 && !needsOn) return null;
  return (
    <span className="action-warnings">
      {warnings.map((warning) => (
        <span key={warning} className="test-target-warning">
          <Icon name="triangle-alert" size={13} />
          {warning}
        </span>
      ))}
      {needsOn && (
        <span className="test-target-warning">
          <Icon name="triangle-alert" size={13} />
          {NEEDS_RUN_ENVIRONMENT_TO_RUN}{" "}
          <Link to="/projects/$projectId/run-environment" params={{ projectId: project.id }}>
            Run environment
          </Link>
        </span>
      )}
    </span>
  );
}
