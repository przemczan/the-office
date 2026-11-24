import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, ActionRunSourceTip, Project } from "@the-office/contracts";
import { Button, Dialog, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { actionRunQueries, startActionRun } from "../../../api/action-runs.ts";
import { projectQueries } from "../../../api/projects.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { shortCommit } from "../../../shell/test-instances/test-instance-words.ts";
import { useToast } from "../../../shell/toasts.tsx";
import { BranchPicker, type BranchChoice } from "../branch-picker.tsx";
import {
  confirmButtonWords,
  confirmWords,
  DIDNT_START,
  fixedToBaseWords,
  readingWords,
  runWindowTitle,
  sourceOf,
  startedToast,
} from "./action-run-words.ts";

/**
 * The Run window (screens/project-page.md, "The Run window"): Run from, the Branch picker with the
 * base branch chosen; the tip of what it means, read as it is chosen; what it runs; Run. For an
 * Action that leaves the workstation it is a confirm step instead: the base branch fixed, the
 * commit it will run named, and a danger button sending that commit. A refusal stays in the window;
 * after one such Action's, the tip is read again, so a branch that moved since shows its new tip.
 */
export function RunWindow({
  project,
  action,
  onClose,
}: {
  readonly project: Project;
  readonly action: Action;
  readonly onClose: () => void;
}): ReactNode {
  const leaves = action.leavesTheWorkstation;
  const [picked, setPicked] = useState<BranchChoice>();
  const choice: BranchChoice =
    leaves || picked === undefined ? { kind: "branch", branch: project.baseBranch } : picked;
  const source = sourceOf(choice);
  const tip = useQuery(actionRunQueries.sourceTip(project.id, source));
  const queryClient = useQueryClient();
  const showToast = useToast();
  const starting = useMutation({
    mutationFn: (commit: string | undefined) =>
      startActionRun(project.id, action.key, {
        source,
        ...(commit === undefined ? {} : { commit }),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({
        queryKey: actionRunQueries.ofProject(project.id).queryKey,
      });
      showToast(startedToast(action.name, run.branch));
      onClose();
    },
    // The branch may have moved since it was read: the confirm step shows its tip now.
    onError: () => {
      if (leaves) void tip.refetch();
    },
  });
  const read = tip.data;
  const commit = read?.kind === "tip" ? read.commit : undefined;
  const short = commit === undefined ? undefined : (shortCommit(commit) ?? commit);
  const runButton = leaves ? (
    <Button
      variant="danger"
      iconLeft={<Icon name="play" size={14} />}
      loading={starting.isPending}
      disabled={starting.isPending || tip.isFetching || commit === undefined}
      onClick={() => starting.mutate(commit)}
    >
      {short === undefined
        ? runWindowTitle(action.name)
        : confirmButtonWords(action.name, project.baseBranch, short)}
    </Button>
  ) : (
    <Button
      variant="primary"
      iconLeft={<Icon name="play" size={14} />}
      loading={starting.isPending}
      disabled={starting.isPending}
      onClick={() => starting.mutate(undefined)}
    >
      Run
    </Button>
  );
  return (
    <Dialog
      size="medium"
      keepsHeight
      title={runWindowTitle(action.name)}
      unsavedChanges={false}
      actions={runButton}
      onClose={onClose}
    >
      <div className="run-window">
        {leaves ? (
          <div className="run-window-fixed">
            <span className="run-window-label">Run from</span>
            <span className="run-window-branch">
              <Icon name="git-branch" size={12} />
              <code>{project.baseBranch}</code>
            </span>
            <p className="run-window-note">{fixedToBaseWords(project.baseBranch)}</p>
          </div>
        ) : (
          <BranchPicker
            project={project}
            label="Run from"
            value={picked}
            onChange={(next) => {
              starting.reset();
              setPicked(next);
            }}
          />
        )}
        <TipLine branch={choice.branch} tip={tip} />
        {leaves && read?.kind === "tip" && short !== undefined ? (
          <p className="run-window-confirm">
            {confirmWords(action.name, project.baseBranch, short, read.subject)}
          </p>
        ) : null}
        <WhatItRuns project={project} action={action} />
        {leaves && action.kind === "workflow" && <FixedInputs inputs={action.settings.inputs} />}
        {starting.error && <RefusalAlert title={DIDNT_START} error={starting.error} />}
      </div>
    </Dialog>
  );
}

/** What it will run: the tip's short commit and subject, "Reading <branch>…", or why it can't. */
function TipLine({
  branch,
  tip,
}: {
  readonly branch: string;
  readonly tip: {
    readonly data: ActionRunSourceTip | undefined;
    readonly error: Error | null;
    readonly isPending: boolean;
  };
}): ReactNode {
  if (tip.isPending) {
    return (
      <p className="run-window-tip" aria-live="polite">
        {readingWords(branch)}
      </p>
    );
  }
  if (tip.error) return <RefusalAlert title={`${branch} can't be read`} error={tip.error} />;
  const read = tip.data;
  if (read === undefined) return null;
  if (read.kind === "problem") {
    return (
      <p className="run-window-tip run-window-problem" aria-live="polite">
        <Icon name="triangle-alert" size={13} />
        {read.problem}
      </p>
    );
  }
  return (
    <p className="run-window-tip" aria-live="polite">
      <code>{shortCommit(read.commit)}</code> {read.subject}
    </p>
  );
}

/**
 * "Runs `build` (after `install`, `seed`)", "Launches Web app; it shows in Test instances." or
 * "Starts `release.yml` on the code host with its fixed inputs."
 */
function WhatItRuns({
  project,
  action,
}: {
  readonly project: Project;
  readonly action: Action;
}): ReactNode {
  const targets = useQuery({
    ...projectQueries.testTargets(project.id),
    enabled: action.kind === "test-target",
  });
  switch (action.kind) {
    case "project-command": {
      const { commandKey, commandsBefore } = action.settings;
      return (
        <p className="run-window-runs">
          Runs <code>{commandKey}</code>
          {commandsBefore.length > 0 && (
            <>
              {" (after "}
              {commandsBefore.map((key, index) => (
                <span key={key}>
                  {index > 0 && ", "}
                  <code>{key}</code>
                </span>
              ))}
              {")"}
            </>
          )}
        </p>
      );
    }
    case "test-target": {
      const { targetKey } = action.settings;
      const name = targets.data?.targets.find(({ key }) => key === targetKey)?.name ?? targetKey;
      return <p className="run-window-runs">Launches {name}; it shows in Test instances.</p>;
    }
    case "workflow":
      return (
        <p className="run-window-runs">
          Starts <code>{action.settings.file}</code> on the code host with its fixed inputs.
        </p>
      );
  }
}

/** A Workflow's fixed inputs in monospace, so two Actions of one Workflow read apart. */
function FixedInputs({
  inputs,
}: {
  readonly inputs: Readonly<Record<string, string | boolean>>;
}): ReactNode {
  const entries = Object.entries(inputs);
  if (entries.length === 0) return null;
  return (
    <ul className="run-window-inputs" aria-label="Its fixed inputs">
      {entries.map(([name, value]) => (
        <li key={name}>
          <code>
            {name}={String(value)}
          </code>
        </li>
      ))}
    </ul>
  );
}
