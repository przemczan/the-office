import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Role, Task, TaskChanges, TaskStages } from "@the-office/contracts";
import { Badge, Button, Dialog, type DialogStep } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { dropAtGate } from "../../api/pipelines.ts";
import { projectQueries } from "../../api/projects.ts";
import { attachmentQueries } from "../../api/work.ts";
import { AttachmentGallery } from "../../shell/attachments/attachment-gallery.tsx";
import { oneRound } from "../../shell/attachments/attachment-rounds.ts";
import { useDroppingTask, WhatDroppingDoes } from "../../shell/work/drop-task-dialog.tsx";
import {
  ContinueRefused,
  SendBackFields,
  useContinuingAtGate,
  useSendingBack,
  type SendingBack,
} from "../../shell/work/gate-actions.tsx";
import {
  continueLabel,
  SEND_BACK_WITH_NOTES,
  type WaitingGate,
} from "../../shell/work/gate-words.ts";
import {
  definitionOfDoneFact,
  gateHeading,
  gateQuestion,
  linesChanged,
  picturesOfThisRound,
  testsBeforeGate,
  testsFact,
} from "./gate-card-words.ts";
import { RECORD_ELEMENT_ID } from "./record-tab.ts";

type GateStep = "send-back" | "drop";

/**
 * The Gate's details (spec 4.1): what the work came to in four facts and the pictures of this
 * round, with every action in the bar. Send back's notes and Drop's confirmation are steps over the
 * bar, as no window opens on another.
 */
export function GateWindow({
  task,
  taskStages,
  waiting,
  roles,
  onClose,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate;
  readonly roles: readonly Role[] | undefined;
  readonly onClose: () => void;
}): ReactNode {
  const [step, setStep] = useState<GateStep>();
  const continuing = useContinuingAtGate(task, waiting);
  const sending = useSendingBack(task, waiting.sendBackTargets, roles, onClose);
  const dropping = useDroppingTask(() => dropAtGate(task.id), onClose);
  const attachments = useQuery(attachmentQueries.of({ kind: "task", taskId: task.id })).data;
  const pictures = picturesOfThisRound(attachments ?? [], taskStages.stages ?? [], waiting);
  const busy = continuing.isPending;
  const cancelStep = (): void => setStep(undefined);
  const steps: Record<GateStep, DialogStep> = {
    "send-back": sendBackStep(sending, cancelStep),
    drop: {
      content: (
        <>
          <p className="dialog-text">
            <strong>Drop {task.title}?</strong>
          </p>
          <WhatDroppingDoes error={dropping.error} />
        </>
      ),
      actions: (
        <Button variant="danger" loading={dropping.isPending} onClick={() => dropping.mutate()}>
          Drop
        </Button>
      ),
      onCancel: cancelStep,
    },
  };
  return (
    <Dialog
      size="large"
      title={
        <span className="gate-window-title">
          <Badge tone="accent">Gate</Badge>
          {gateHeading(waiting)}
        </span>
      }
      onClose={onClose}
      step={step && steps[step]}
      actions={
        <>
          <Button
            variant="accent"
            loading={continuing.isPending}
            disabled={busy}
            onClick={() => continuing.mutate(undefined, { onSuccess: onClose })}
          >
            {continueLabel(waiting)}
          </Button>
          <OpenChanges onOpen={onClose} />
          {waiting.sendBackTargets.length > 0 && (
            <Button variant="secondary" disabled={busy} onClick={() => setStep("send-back")}>
              {SEND_BACK_WITH_NOTES}
            </Button>
          )}
          <Button variant="danger" disabled={busy} onClick={() => setStep("drop")}>
            Drop
          </Button>
        </>
      }
    >
      <div className="gate-window">
        {continuing.error && <ContinueRefused error={continuing.error} />}
        <div className="gate-question">{gateQuestion(waiting)}</div>
        <GateFacts task={task} taskStages={taskStages} waiting={waiting} />
        {pictures.length > 0 && (
          <section aria-label="Screenshots">
            <AttachmentGallery rounds={oneRound(pictures)} />
          </section>
        )}
      </div>
    </Dialog>
  );
}

function sendBackStep(sending: SendingBack, onCancel: () => void): DialogStep {
  return {
    content: <SendBackFields sending={sending} />,
    actions: (
      <Button
        loading={sending.isPending}
        disabled={!sending.written}
        title={sending.written ? undefined : "Write your feedback first"}
        onClick={sending.send}
      >
        Send back
      </Button>
    ),
    onCancel,
  };
}

function GateFacts({
  task,
  taskStages,
  waiting,
}: {
  readonly task: Task;
  readonly taskStages: TaskStages;
  readonly waiting: WaitingGate;
}): ReactNode {
  const changes = useQuery(projectQueries.taskChanges(task.projectId, task.id)).data;
  const checks = testsBeforeGate(taskStages.testResults, taskStages.stages ?? [], waiting);
  return (
    <dl className="gate-facts">
      <GateFact label="Files changed">{changes?.files.length ?? "–"}</GateFact>
      <GateFact label="Lines">{changes ? <LinesFact changes={changes} /> : "–"}</GateFact>
      <GateFact label="Tests" failed={checks.some(({ state }) => state === "failed")}>
        {testsFact(checks)}
      </GateFact>
      <GateFact label="Definition of Done">
        {definitionOfDoneFact(task, taskStages.definitionOfDoneMet)}
      </GateFact>
    </dl>
  );
}

function GateFact({
  label,
  failed = false,
  children,
}: {
  readonly label: string;
  readonly failed?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className={`gate-fact${failed ? " gate-fact-failed" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LinesFact({ changes }: { readonly changes: TaskChanges }): ReactNode {
  const { added, removed } = linesChanged(changes.files);
  return (
    <>
      <span className="changes-added">+{added}</span>{" "}
      <span className="changes-removed">−{removed}</span>
    </>
  );
}

/** The Changes tab, brought into view: the card may have pushed it below the fold. */
function OpenChanges({ onOpen }: { readonly onOpen: () => void }): ReactNode {
  return (
    <Link
      className="link-button"
      from="/tasks/$taskId"
      to="."
      search={(shown) => ({ ...shown, recordTab: "changes" })}
      onClick={() => {
        onOpen();
        document.getElementById(RECORD_ELEMENT_ID)?.scrollIntoView({ block: "start" });
      }}
    >
      Open Changes
    </Link>
  );
}
