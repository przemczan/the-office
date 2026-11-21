import { useQuery } from "@tanstack/react-query";
import {
  BUG_TASK_CREATE_OPTION,
  BUG_TASK_DONT_CREATE_OPTION,
  type BugTaskFields,
  type Decision,
  type DecisionFormAnswer,
} from "@the-office/contracts";
import {
  Button,
  Dialog,
  Field,
  Icon,
  Input,
  SearchableSelect,
  Select,
  Textarea,
} from "@the-office/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { projectQueries } from "../../api/projects.ts";
import { taskQueries, useEveryTask } from "../../api/work.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { MentionField } from "../mentions/mention-field.tsx";
import { useMentions } from "../mentions/mention-picker.tsx";
import { TaskStateBadge } from "../work/task-state-badge.tsx";
import { useDecisionDraft, useTakeOver } from "./decision-drafts.tsx";
import {
  AnswerRefused,
  AnsweringHints,
  askerName,
  ConsultationNote,
  ContextFirstLine,
  stillAnsweringHint,
  TAKE_IT_OVER_FIRST,
  useAnswering,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";

/** Where the Bug Task goes once created, as the card's bar says. */
export const BUG_TASK_GOES = "It goes to Backlog as a Bug, found while working on this Task.";

/** The card's words for the Agent's proposal, over its why. */
export function proposesWords(asker: string): string {
  return `${asker} proposes a Bug Task`;
}

/** What the card holds while the user edits it: the proposal at first, and the general comment. */
interface BugTaskForm {
  readonly fields: BugTaskFields;
  setFields(fields: BugTaskFields): void;
  readonly generalComment: string;
  setGeneralComment(comment: string): void;
  readonly askingAgain: boolean;
  setAskingAgain(asking: boolean): void;
  readonly sending: ReturnType<typeof useAnswering>;
  /** Why nothing can be sent yet; undefined when it can. */
  readonly waits: string | undefined;
  /** Why Create the Bug Task can't be pressed yet; undefined when it can. */
  readonly createBlocked: string | undefined;
  create(onSent?: () => void): void;
  dontCreate(onSent?: () => void): void;
  askAgain(onSent?: () => void): void;
  readonly asker: string;
}

function useBugTaskForm({ decision, personName, answering }: DecisionAnsweringProps): BugTaskForm {
  const proposed = decision.bugTask;
  const [fields, setFields] = useState<BugTaskFields>({
    title: proposed?.title ?? "",
    description: proposed?.description ?? "",
    projectId: proposed?.projectId ?? "",
    causedBy: proposed?.causedBy ?? null,
  });
  const [askingAgain, setAskingAgain] = useState(false);
  // The general comment is the Decision's draft, as on any form, so it stays wherever it shows.
  const handle = useDecisionDraft(decision);
  const sending = useAnswering(decision, handle.clear);
  const { locked } = useTakeOver(decision);
  const asker = askerName(decision, personName);
  const waits =
    stillAnsweringHint(answering, asker) ??
    (locked ? TAKE_IT_OVER_FIRST : sending.isPending ? "Sending your answer…" : undefined);
  const comment = handle.draft.generalComment.trim();
  const withComment = comment === "" ? {} : { generalComment: comment };
  const send = (answer: DecisionFormAnswer, onSent?: () => void): void =>
    sending.mutate(answer, { onSuccess: () => onSent?.() });
  return {
    fields,
    setFields,
    generalComment: handle.draft.generalComment,
    setGeneralComment: handle.setGeneralComment,
    askingAgain,
    setAskingAgain,
    sending,
    waits,
    createBlocked: waits ?? (fields.title.trim() === "" ? "Write a title first." : undefined),
    create: (onSent) =>
      send(
        {
          kind: "submitted",
          answers: [{ kind: "option", option: BUG_TASK_CREATE_OPTION }],
          bugTask: { ...fields, title: fields.title.trim() },
          ...withComment,
        },
        onSent,
      ),
    dontCreate: (onSent) =>
      send(
        {
          kind: "submitted",
          answers: [{ kind: "option", option: BUG_TASK_DONT_CREATE_OPTION }],
          ...withComment,
        },
        onSent,
      ),
    askAgain: (onSent) =>
      send({ kind: "asked-again", ...withComment }, () => {
        setAskingAgain(false);
        onSent?.();
      }),
    asker,
  };
}

/**
 * A bug-task Decision (docs/design/issues-as-tasks.html, "Bug Task Decision"): the Agent's
 * proposal as editable fields, the general comment, and Create the Bug Task, Don't create it and
 * Ask me again; never Dismiss. In the shared feed it is compact, its form in a Large window.
 */
export function BugTaskCard({
  compact,
  ...answering
}: DecisionAnsweringProps & { readonly compact: boolean }): ReactNode {
  const form = useBugTaskForm(answering);
  const [windowOpen, setWindowOpen] = useState(false);
  const { decision, answering: personAnswering, reachesAtTurnEnd = false } = answering;
  if (!compact) {
    return (
      <div className="decision-form bug-task-form">
        <p className="decision-overline">{proposesWords(form.asker)}</p>
        <BugTaskWhy decision={decision} />
        <ConsultationNote decision={decision} />
        <BugTaskFieldsForm form={form} />
        {form.askingAgain ? (
          <BugTaskAskAgain form={form} />
        ) : (
          <>
            <BugTaskGeneralComment form={form} />
            {form.sending.error && <AnswerRefused error={form.sending.error} />}
            <div className="decision-actions">
              <BugTaskActions form={form} />
              <span className="decision-hint">{BUG_TASK_GOES}</span>
            </div>
          </>
        )}
        <AnsweringHints
          personName={form.asker}
          answering={personAnswering}
          reachesAtTurnEnd={reachesAtTurnEnd}
        />
      </div>
    );
  }
  return (
    <div className="decision-compact bug-task-compact">
      <ContextFirstLine decision={decision} />
      <p className="decision-compact-question">Bug Task: {form.fields.title}</p>
      {form.sending.error && <AnswerRefused error={form.sending.error} />}
      <div className="decision-actions">
        <Button onClick={() => setWindowOpen(true)}>Open details</Button>
      </div>
      {windowOpen && (
        <BugTaskWindow decision={decision} form={form} onClose={() => setWindowOpen(false)} />
      )}
    </div>
  );
}

/** A bug-task Decision's window alone, as a Mention of it opens it. */
export function BugTaskWindowOf({
  onClose,
  ...answering
}: DecisionAnsweringProps & { readonly onClose: () => void }): ReactNode {
  const form = useBugTaskForm(answering);
  return <BugTaskWindow decision={answering.decision} form={form} onClose={onClose} />;
}

/** The compact card's window, Large: the same form, with its three actions in the bar. */
function BugTaskWindow({
  decision,
  form,
  onClose,
}: {
  readonly decision: Decision;
  readonly form: BugTaskForm;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      size="large"
      title={proposesWords(form.asker)}
      onClose={onClose}
      step={
        form.askingAgain
          ? {
              content: <AskAgainField form={form} />,
              actions: <ConfirmAskAgain form={form} onSent={onClose} />,
              onCancel: () => form.setAskingAgain(false),
            }
          : undefined
      }
      actions={<BugTaskActions form={form} onSent={onClose} />}
    >
      <div className="decision-form bug-task-form">
        <BugTaskWhy decision={decision} />
        <BugTaskFieldsForm form={form} />
        <BugTaskGeneralComment form={form} />
        {form.sending.error && <AnswerRefused error={form.sending.error} />}
        <p className="decision-hint">{BUG_TASK_GOES}</p>
      </div>
    </Dialog>
  );
}

function BugTaskWhy({ decision }: { readonly decision: Decision }): ReactNode {
  const why = decision.bugTask?.why ?? decision.context;
  if (why === "") return null;
  return (
    <div className="decision-context">
      <MarkdownText text={why} />
    </div>
  );
}

/** The proposal's fields, as edited: Title (required), Description, Project and Caused by. */
function BugTaskFieldsForm({ form }: { readonly form: BugTaskForm }): ReactNode {
  const { fields, setFields } = form;
  const projects = useQuery(projectQueries.list()).data;
  const tasks = useEveryTask().data ?? [];
  const mentions = useMentions(fields.description, (description) =>
    setFields({ ...fields, description }),
  );
  const disabled = form.sending.isPending;
  return (
    <div className="bug-task-fields">
      <Input
        label="Title"
        required
        value={fields.title}
        disabled={disabled}
        onChange={(event) => setFields({ ...fields, title: event.target.value })}
      />
      <MentionField
        label="Description"
        rows={6}
        value={fields.description}
        disabled={disabled}
        onChange={(description) => setFields({ ...fields, description })}
        mentions={mentions}
      />
      <div className="bug-task-fields-row">
        <Select
          label="Project"
          value={fields.projectId}
          disabled={disabled}
          options={(projects ?? []).map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(projectId) => setFields({ ...fields, projectId })}
        />
        <Field label="Caused by" hint="Optional.">
          <SearchableSelect
            label="Caused by"
            labelHidden
            placeholder="Find a Task by its title"
            value={fields.causedBy ?? ""}
            options={tasks.map(({ id, title }) => ({ value: id, label: title }))}
            onChange={(causedBy) =>
              setFields({ ...fields, causedBy: causedBy === "" ? null : causedBy })
            }
            clearLabel="Clear what caused it"
            noMatches="No Task matches"
          />
        </Field>
      </div>
    </div>
  );
}

function BugTaskGeneralComment({ form }: { readonly form: BugTaskForm }): ReactNode {
  return (
    <div className="decision-general">
      <Textarea
        label="General comment"
        hint="Optional."
        rows={2}
        placeholder="Anything about the form as a whole"
        value={form.generalComment}
        disabled={form.sending.isPending}
        onChange={(event) => form.setGeneralComment(event.target.value)}
      />
    </div>
  );
}

/** Create the Bug Task, Don't create it and Ask me again; no Dismiss, as in any Stage Thread. */
function BugTaskActions({
  form,
  onSent,
}: {
  readonly form: BugTaskForm;
  readonly onSent?: () => void;
}): ReactNode {
  // Both are a Submit: Create sends the fields, Don't create it sends none.
  const sent = form.sending.isPending ? form.sending.variables : undefined;
  const submitted = sent?.kind === "submitted" ? sent : undefined;
  return (
    <>
      <Button
        disabled={form.createBlocked !== undefined}
        title={form.createBlocked}
        loading={submitted?.bugTask !== undefined}
        onClick={() => form.create(onSent)}
      >
        Create the Bug Task
      </Button>
      <Button
        variant="secondary"
        disabled={form.waits !== undefined}
        title={form.waits}
        loading={submitted !== undefined && submitted.bugTask === undefined}
        onClick={() => form.dontCreate(onSent)}
      >
        Don't create it
      </Button>
      <Button
        variant="secondary"
        iconLeft={<Icon name="rotate-ccw" size={13} />}
        disabled={form.waits !== undefined}
        title={form.waits}
        onClick={() => form.setAskingAgain(true)}
      >
        Ask me again
      </Button>
    </>
  );
}

function AskAgainField({ form }: { readonly form: BugTaskForm }): ReactNode {
  return (
    <div className="decision-ask-again-field">
      <Textarea
        label={`What should ${form.asker} explain or change?`}
        hint="Optional."
        rows={2}
        placeholder="Your general comment, sent alone"
        value={form.generalComment}
        disabled={form.sending.isPending}
        autoFocus
        onChange={(event) => form.setGeneralComment(event.target.value)}
      />
      <p className="decision-hint">
        Sends this comment alone. {form.asker} explains and asks again in a new card.
      </p>
    </div>
  );
}

function ConfirmAskAgain({
  form,
  onSent,
}: {
  readonly form: BugTaskForm;
  readonly onSent?: () => void;
}): ReactNode {
  return (
    <Button
      iconLeft={<Icon name="rotate-ccw" size={13} />}
      disabled={form.waits !== undefined}
      title={form.waits}
      onClick={() => form.askAgain(onSent)}
    >
      Ask me again
    </Button>
  );
}

/** The step before Ask me again, in place of the card's actions (spec 4.1). */
function BugTaskAskAgain({ form }: { readonly form: BugTaskForm }): ReactNode {
  return (
    <section className="decision-ask-again" aria-label="Ask me again">
      <AskAgainField form={form} />
      {form.sending.error && <AnswerRefused error={form.sending.error} />}
      <div className="decision-actions">
        <ConfirmAskAgain form={form} />
        <Button variant="secondary" onClick={() => form.setAskingAgain(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/**
 * An answered bug-task Decision's line: "Created the Bug Task <Task>" with its state, or "Didn't
 * create the Bug Task".
 */
export function BugTaskAnswered({ decision }: { readonly decision: Decision }): ReactNode {
  const answer = decision.formAnswer;
  const created = answer?.kind === "submitted" ? answer.createdTaskId : undefined;
  const task = useQuery({ ...taskQueries.one(created ?? ""), enabled: created !== undefined }).data;
  if (answer?.kind !== "submitted") return null;
  if (created === undefined) {
    return <p className="decision-answer-words">Didn't create the Bug Task</p>;
  }
  return (
    <p className="decision-answer-words bug-task-created">
      Created the Bug Task{" "}
      <Link to="/tasks/$taskId" params={{ taskId: created }}>
        {task?.title ?? answer.bugTask?.title ?? "the Bug Task"}
      </Link>
      {task && <TaskStateBadge state={task.state} />}
    </p>
  );
}
