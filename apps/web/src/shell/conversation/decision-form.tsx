import type { Attachment, Decision, DecisionQuestion } from "@the-office/contracts";
import {
  Badge,
  Button,
  CheckboxList,
  Dialog,
  FoldButton,
  Icon,
  ProgressBar,
  RadioList,
  TextButton,
  Textarea,
} from "@the-office/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AttachmentGallery } from "../attachments/attachment-gallery.tsx";
import { oneRound } from "../attachments/attachment-rounds.ts";
import { MarkdownText } from "../markdown-text.tsx";
import { useDecisionDraft, useTakeOver, type DecisionDraftHandle } from "./decision-drafts.tsx";
import {
  answeredCount,
  askedAgainAnswer,
  canBeDismissed,
  dismissedAnswer,
  draftAnswerWords,
  EMPTY_QUESTION_DRAFT,
  inWords as answersInWords,
  isAnswered,
  missingAnswer,
  progressWords,
  submitBlockedWords,
  submittedAnswer,
  type DecisionDraft,
  type QuestionDraft,
} from "./decision-form-words.ts";
import {
  AnswerRefused,
  AnsweringHints,
  askerName,
  ConsultationNote,
  DecisionDetail,
  DecisionHeading,
  FollowUpsHint,
  TAKE_IT_OVER_FIRST,
  useAnswering,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";

/**
 * The Decision form (spec §2.4, the Decision form card's design): each question, a choice picked
 * from its options with the recommended one picked at first, a choice of several with its
 * recommended ones checked at first, or an open question answered in words, each with its comment;
 * the general comment; then Submit, Ask me again, or Dismiss. In place it is the card's body; in a
 * window (Open details), the questions listed beside the picked one, with Submit, Ask me again and
 * Dismiss in the bar. Its draft is the Decision's, wherever it shows.
 */
export type DecisionFormProps = DecisionAnsweringProps &
  (
    | {
        readonly layout: "in-place";
        /** Where the user asks the person something first: "in the Thread", or "below" in a chat. */
        readonly followUpsWhere?: string;
      }
    | {
        readonly layout: "window";
        readonly attachments: readonly Attachment[];
        /** The question the window opens at, by its index. */
        readonly firstQuestion?: number;
        readonly onClose: () => void;
      }
  );

export function DecisionForm(props: DecisionFormProps): ReactNode {
  const form = useDecisionForm(props);
  return props.layout === "in-place" ? (
    <FormInPlace {...props} form={form} />
  ) : (
    <FormWindow {...props} form={form} />
  );
}

/** What both layouts share: the draft, sending it, and why Submit or Ask me again waits. */
interface DecisionFormState {
  readonly formId: string;
  readonly asker: string;
  readonly handle: DecisionDraftHandle;
  readonly sending: ReturnType<typeof useAnswering>;
  readonly disabled: boolean;
  /** Why Submit can't be pressed yet; undefined when it can. */
  readonly submitBlocked: string | undefined;
  /** Why Ask me again can't be pressed yet; undefined when it can. */
  readonly askAgainBlocked: string | undefined;
  /** The Office's own Decisions and approvals have nobody to ask again. */
  readonly canAskAgain: boolean;
  readonly askingAgain: boolean;
  setAskingAgain(asking: boolean): void;
  submit(onSent?: () => void): void;
  askAgain(onSent?: () => void): void;
  readonly dismissal: Dismissal;
}

/**
 * Dismiss (spec §2.4): shown only on a Decision the user can close unanswered; its step asks for
 * the general comment, sent with the user's next message in the Thread.
 */
export interface Dismissal {
  readonly can: boolean;
  /** The step is open. */
  readonly open: boolean;
  /** Why Dismiss can't be pressed yet; undefined when it can. */
  readonly blocked: string | undefined;
  readonly disabled: boolean;
  readonly asker: string;
  readonly handle: DecisionDraftHandle;
  readonly error: Error | null;
  setOpen(open: boolean): void;
  dismiss(onSent?: () => void): void;
}

/** Dismiss's state for a card: sent through the card's own answering, its comment the draft's. */
export function useDismissal({
  decision,
  asker,
  handle,
  sending,
}: {
  readonly decision: Decision;
  readonly asker: string;
  readonly handle: DecisionDraftHandle;
  readonly sending: ReturnType<typeof useAnswering>;
}): Dismissal {
  const [open, setOpen] = useState(false);
  return {
    can: canBeDismissed(decision),
    open,
    // No turn starts, so the person may still be answering.
    blocked: sending.isPending ? "Sending your answer…" : undefined,
    disabled: sending.isPending,
    asker,
    handle,
    error: sending.error,
    setOpen,
    dismiss: (onSent) =>
      sending.mutate(dismissedAnswer(handle.draft.generalComment), {
        onSuccess: () => {
          setOpen(false);
          onSent?.();
        },
      }),
  };
}

function useDecisionForm({
  decision,
  personName,
  answering,
}: DecisionAnsweringProps): DecisionFormState {
  const formId = useId();
  const handle = useDecisionDraft(decision);
  const sending = useAnswering(decision, handle.clear);
  const { locked } = useTakeOver(decision);
  const [askingAgain, setAskingAgain] = useState(false);
  const asker = askerName(decision, personName);
  const dismissal = useDismissal({ decision, asker, handle, sending });
  const pending = sending.isPending ? "Sending your answer…" : undefined;
  const waits = locked ? TAKE_IT_OVER_FIRST : pending;
  return {
    formId,
    asker,
    handle,
    sending,
    disabled: sending.isPending || locked,
    submitBlocked: answering
      ? `${asker} is still answering. Answer once they finish.`
      : (waits ?? submitBlockedWords(decision, handle.draft)),
    askAgainBlocked: answering ? `${asker} is still answering. Ask again once they finish.` : waits,
    canAskAgain: decision.roleKey !== null && decision.kind !== "approval",
    askingAgain,
    setAskingAgain,
    submit: (onSent) =>
      sending.mutate(submittedAnswer(decision, handle.draft), { onSuccess: () => onSent?.() }),
    askAgain: (onSent) =>
      sending.mutate(askedAgainAnswer(handle.draft.generalComment), {
        onSuccess: () => {
          setAskingAgain(false);
          onSent?.();
        },
      }),
    dismissal,
  };
}

function FormInPlace({
  decision,
  personName,
  answering,
  reachesAtTurnEnd = false,
  followUps,
  followUpsWhere,
  form,
}: DecisionAnsweringProps & {
  readonly followUpsWhere?: string;
  readonly form: DecisionFormState;
}): ReactNode {
  const { draft } = form.handle;
  const several = decision.questions.length > 1;
  const jump = (index: number): void => focusQuestion(questionElementId(form.formId, index));
  return (
    <div className="decision-form">
      <DecisionDetail decision={decision} />
      <ConsultationNote decision={decision} />
      {decision.questions.map((question, index) => (
        <QuestionBlock
          key={index}
          decision={decision}
          question={question}
          index={index}
          numbered={several}
          form={form}
        />
      ))}
      {form.askingAgain ? (
        <AskAgainStep form={form} />
      ) : form.dismissal.open ? (
        <DismissStep dismissal={form.dismissal} />
      ) : (
        <>
          <div className="decision-general">
            <GeneralComment form={form} />
          </div>
          {form.sending.error && <AnswerRefused error={form.sending.error} />}
          <div className="decision-actions">
            <SubmitButton form={form} />
            {form.canAskAgain && <AskMeAgainButton form={form} />}
            {form.dismissal.can && <DismissButton dismissal={form.dismissal} />}
            {several && <ProgressLine decision={decision} draft={draft} onJump={jump} />}
          </div>
        </>
      )}
      <AnsweringHints
        personName={form.asker}
        answering={answering}
        reachesAtTurnEnd={reachesAtTurnEnd}
      />
      <FollowUpsHint
        decision={decision}
        personName={personName}
        followUps={followUps}
        {...(followUpsWhere === undefined ? {} : { where: followUpsWhere })}
      />
    </div>
  );
}

/**
 * Open details (spec 4.1, list and details): the questions on the left, each with its answer so
 * far, the picked one on the right; under 900px a row of numbers above it. One question is the
 * form alone. Closing keeps the draft, so the window doesn't ask first.
 */
function FormWindow({
  decision,
  personName,
  answering,
  reachesAtTurnEnd = false,
  followUps,
  attachments,
  firstQuestion = 0,
  onClose,
  form,
}: DecisionAnsweringProps & {
  readonly attachments: readonly Attachment[];
  readonly firstQuestion?: number;
  readonly onClose: () => void;
  readonly form: DecisionFormState;
}): ReactNode {
  const { draft } = form.handle;
  const count = decision.questions.length;
  const [current, setCurrent] = useState(Math.min(Math.max(firstQuestion, 0), count - 1));
  const focusing = useRef(false);
  useEffect(() => {
    if (!focusing.current) return;
    focusing.current = false;
    focusQuestion(questionElementId(form.formId, current));
  }, [current, form.formId]);
  const go = (index: number, focus = false): void => {
    if (focus && index === current) focusQuestion(questionElementId(form.formId, index));
    else focusing.current = focus;
    setCurrent(index);
  };
  const question = decision.questions[current];
  return (
    <Dialog
      size="large"
      keepsHeight={count > 1}
      title={
        <span className="decision-window-title">
          <DecisionHeading decision={decision} personName={personName} />
          {count > 1 && <span className="decision-count">· {count} questions</span>}
        </span>
      }
      unsavedChanges={false}
      onClose={onClose}
      actions={
        <>
          <SubmitButton form={form} onSent={onClose} />
          {form.canAskAgain && <AskMeAgainButton form={form} />}
          {form.dismissal.can && <DismissButton dismissal={form.dismissal} />}
        </>
      }
      step={
        form.askingAgain
          ? {
              content: <AskAgainField form={form} autoFocus />,
              actions: <ConfirmAskAgainButton form={form} onSent={onClose} />,
              onCancel: () => form.setAskingAgain(false),
            }
          : form.dismissal.open
            ? {
                content: <DismissField dismissal={form.dismissal} autoFocus />,
                actions: <ConfirmDismissButton dismissal={form.dismissal} onSent={onClose} />,
                onCancel: () => form.dismissal.setOpen(false),
              }
            : undefined
      }
    >
      <div className={`decision-window${count > 1 ? " several" : ""}`}>
        {count > 1 && (
          <div className="decision-window-progress">
            <ProgressLine decision={decision} draft={draft} onJump={(index) => go(index, true)} />
          </div>
        )}
        {count > 1 && (
          <div className="decision-window-split">
            <nav className="decision-window-list" aria-label="Questions">
              {decision.questions.map((listed, index) => (
                <button
                  key={index}
                  type="button"
                  className="decision-window-row"
                  aria-current={index === current}
                  onClick={() => go(index)}
                >
                  <QuestionNumber
                    number={index + 1}
                    answered={isAnswered(listed, draft.questions[index])}
                  />
                  <span className="decision-window-row-text">{listed.question}</span>
                  <span
                    className={`decision-window-row-state${isAnswered(listed, draft.questions[index]) ? "" : " missing"}`}
                  >
                    {draftAnswerWords(listed, draft.questions[index] ?? EMPTY_QUESTION_DRAFT)}
                  </span>
                </button>
              ))}
            </nav>
            <div className="decision-window-numbers" role="group" aria-label="Questions by number">
              {decision.questions.map((listed, index) => (
                <button
                  key={index}
                  type="button"
                  className={isAnswered(listed, draft.questions[index]) ? "answered" : "missing"}
                  aria-label={`Question ${index + 1}`}
                  aria-current={index === current}
                  onClick={() => go(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="decision-window-detail">
              <WindowContext decision={decision} attachments={attachments} />
              <p className="decision-window-overline">
                Question {current + 1} of {count}
              </p>
              {question && (
                <QuestionBlock
                  decision={decision}
                  question={question}
                  index={current}
                  numbered={false}
                  form={form}
                />
              )}
              <div className="decision-window-nav">
                {current > 0 && (
                  <Button
                    variant="secondary"
                    iconLeft={<Icon name="chevron-left" size={14} />}
                    onClick={() => go(current - 1)}
                  >
                    Previous
                  </Button>
                )}
                {current < count - 1 ? (
                  <Button
                    variant="secondary"
                    iconRight={<Icon name="chevron-right" size={14} />}
                    onClick={() => go(current + 1)}
                  >
                    Next
                  </Button>
                ) : (
                  // The last question sends from where the user is, as the bar's Submit does.
                  !form.askingAgain &&
                  !form.dismissal.open && <SubmitButton form={form} onSent={onClose} />
                )}
              </div>
            </div>
          </div>
        )}
        {count === 1 && question && (
          <div className="decision-window-scroll">
            <WindowContext decision={decision} attachments={attachments} />
            <QuestionBlock
              decision={decision}
              question={question}
              index={0}
              numbered={false}
              form={form}
            />
          </div>
        )}
        <div className="decision-window-foot">
          {!form.askingAgain && !form.dismissal.open && <GeneralComment form={form} />}
          {form.sending.error && <AnswerRefused error={form.sending.error} />}
          <AnsweringHints
            personName={form.asker}
            answering={answering}
            reachesAtTurnEnd={reachesAtTurnEnd}
          />
          <FollowUpsHint decision={decision} personName={personName} followUps={followUps} />
        </div>
      </div>
    </Dialog>
  );
}

/** The context, who passed it on and the Attachments, folded above the picked question. */
function WindowContext({
  decision,
  attachments,
}: {
  readonly decision: Decision;
  readonly attachments: readonly Attachment[];
}): ReactNode {
  const [open, setOpen] = useState(true);
  const hasAny =
    decision.context !== "" ||
    decision.passedOn.length > 0 ||
    decision.putTo !== null ||
    attachments.length > 0;
  if (!hasAny) return null;
  const label =
    attachments.length === 0
      ? "Context"
      : `Context and ${attachments.length} Attachment${attachments.length === 1 ? "" : "s"}`;
  return (
    <div className="decision-window-context">
      <FoldButton unfolded={open} onClick={() => setOpen(!open)}>
        {label}
      </FoldButton>
      {open && (
        <>
          <DecisionDetail decision={decision} />
          <ConsultationNote decision={decision} />
          {attachments.length > 0 && <AttachmentGallery rounds={oneRound(attachments)} />}
        </>
      )}
    </div>
  );
}

/** One question as the form asks it: its options or its box, the recommendation, its comment. */
function QuestionBlock({
  decision,
  question,
  index,
  numbered,
  form,
}: {
  readonly decision: Decision;
  readonly question: DecisionQuestion;
  readonly index: number;
  readonly numbered: boolean;
  readonly form: DecisionFormState;
}): ReactNode {
  const draft = form.handle.draft.questions[index] ?? EMPTY_QUESTION_DRAFT;
  const update = (change: Partial<QuestionDraft>): void => form.handle.update(index, change);
  const inWords = answersInWords(question, draft);
  return (
    <div
      id={questionElementId(form.formId, index)}
      className={`decision-form-question${numbered ? "" : " unnumbered"}`}
      role="group"
      aria-label={`Question ${index + 1}`}
    >
      {/* A request's one question is the card's "Asked you to" line already. */}
      {decision.kind !== "request" && (
        <div className="decision-form-question-head">
          {numbered && <QuestionNumber number={index + 1} answered={isAnswered(question, draft)} />}
          <div className="decision-form-question-text">
            <MarkdownText text={question.question} inline />
            {question.kind === "open" && (
              <span className="decision-form-question-kind">Answered in words</span>
            )}
            {question.kind === "choice-of-several" && (
              <span className="decision-form-question-kind">Pick every option that applies.</span>
            )}
          </div>
        </div>
      )}
      <div className="decision-form-question-body">
        {question.kind === "choice" ? (
          <>
            <RadioList
              label={question.question}
              name={`${form.formId}-q${index}`}
              value={draft.option === null ? NONE_OF_THESE : String(draft.option)}
              disabled={form.disabled}
              onChange={(value) =>
                update({ option: value === NONE_OF_THESE ? null : Number(value) })
              }
              options={[
                ...question.options.map((option, at) => ({
                  value: String(at),
                  label: option,
                  aside: at === question.recommendation.option && (
                    <Badge tone="accent" size="sm">
                      Recommended
                    </Badge>
                  ),
                })),
                // An approval is Allow once or Deny, never words (spec §2.4).
                ...(decision.kind === "approval"
                  ? []
                  : [{ value: NONE_OF_THESE, label: "None of these: answer in words" }]),
              ]}
            />
            <p className="decision-recommendation">
              {form.asker} recommends “{question.options[question.recommendation.option]}”:{" "}
              <MarkdownText text={question.recommendation.reason} inline />
            </p>
            {inWords && <WordsInstead draft={draft} form={form} update={update} />}
          </>
        ) : question.kind === "choice-of-several" ? (
          <>
            <CheckboxList
              label={question.question}
              values={draft.options.map(String)}
              disabled={form.disabled}
              onChange={(values) => update({ options: values.map(Number) })}
              options={question.options.map((option, at) => ({
                value: String(at),
                label: option,
                aside: question.recommendation.options.includes(at) && (
                  <Badge tone="accent" size="sm">
                    Recommended
                  </Badge>
                ),
              }))}
            />
            <p className="decision-recommendation">
              {form.asker} recommends{" "}
              {question.recommendation.options
                .map((at) => `“${question.options[at] ?? ""}”`)
                .join(", ")}
              : <MarkdownText text={question.recommendation.reason} inline />
            </p>
            {inWords && <WordsInstead draft={draft} form={form} update={update} />}
          </>
        ) : (
          <>
            {question.why !== undefined && question.why !== "" && (
              <p className="decision-recommendation">
                Why {form.asker} needs it: <MarkdownText text={question.why} inline />
              </p>
            )}
            <Textarea
              label="Your answer"
              required
              rows={2}
              placeholder={
                decision.kind === "request"
                  ? "Say what you did, or why you can't"
                  : "Your answer in words"
              }
              value={draft.words}
              disabled={form.disabled}
              onChange={(event) => update({ words: event.target.value })}
            />
          </>
        )}
        {!inWords && decision.kind !== "approval" && (
          <CommentField
            comment={draft.comment}
            disabled={form.disabled}
            onChange={(comment) => update({ comment })}
          />
        )}
      </div>
    </div>
  );
}

/** A choice's answer in words, once none of its options is picked: its comment, required then. */
function WordsInstead({
  draft,
  form,
  update,
}: {
  readonly draft: QuestionDraft;
  readonly form: DecisionFormState;
  readonly update: (change: Partial<QuestionDraft>) => void;
}): ReactNode {
  return (
    <Textarea
      label="Your answer in words"
      required
      rows={2}
      placeholder="None of the options: say what you want instead"
      value={draft.comment}
      disabled={form.disabled}
      onChange={(event) => update({ comment: event.target.value })}
    />
  );
}

/** The "None of these" line's value among the options' indexes. */
const NONE_OF_THESE = "none";

/** A question's number: green once answered, dashed amber while it needs an answer. */
function QuestionNumber({
  number,
  answered,
}: {
  readonly number: number;
  readonly answered: boolean;
}): ReactNode {
  return (
    <span className={`decision-form-number ${answered ? "answered" : "missing"}`}>
      {number}
      <span className="visually-hidden">{answered ? ", answered" : ", needs an answer"}</span>
    </span>
  );
}

/** A question's comment, folded behind "Add a comment" until opened or written. */
function CommentField({
  comment,
  disabled,
  onChange,
}: {
  readonly comment: string;
  readonly disabled: boolean;
  readonly onChange: (comment: string) => void;
}): ReactNode {
  const [opened, setOpened] = useState(false);
  if (!opened && comment.trim() === "") {
    return (
      <TextButton className="decision-add-comment" onClick={() => setOpened(true)}>
        <Icon name="plus" size={12} /> Add a comment
      </TextButton>
    );
  }
  return (
    <Textarea
      label="Comment"
      hint="Optional."
      rows={2}
      placeholder="Anything to add to this answer"
      value={comment}
      disabled={disabled}
      autoFocus={opened && comment === ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function GeneralComment({ form }: { readonly form: DecisionFormState }): ReactNode {
  return (
    <Textarea
      label="General comment"
      hint="Optional."
      rows={2}
      placeholder="Anything about the form as a whole"
      value={form.handle.draft.generalComment}
      disabled={form.disabled}
      onChange={(event) => form.handle.setGeneralComment(event.target.value)}
    />
  );
}

function SubmitButton({
  form,
  onSent,
}: {
  readonly form: DecisionFormState;
  readonly onSent?: () => void;
}): ReactNode {
  return (
    <Button
      disabled={form.submitBlocked !== undefined}
      title={form.submitBlocked}
      onClick={() => form.submit(onSent)}
    >
      Submit
    </Button>
  );
}

/** Opens the step that says what to explain or change; nothing is sent yet. */
function AskMeAgainButton({ form }: { readonly form: DecisionFormState }): ReactNode {
  return (
    <Button
      variant="secondary"
      iconLeft={<Icon name="rotate-ccw" size={13} />}
      disabled={form.askAgainBlocked !== undefined}
      title={form.askAgainBlocked}
      onClick={() => form.setAskingAgain(true)}
    >
      Ask me again
    </Button>
  );
}

function ConfirmAskAgainButton({
  form,
  onSent,
}: {
  readonly form: DecisionFormState;
  readonly onSent?: () => void;
}): ReactNode {
  return (
    <Button
      iconLeft={<Icon name="rotate-ccw" size={13} />}
      disabled={form.askAgainBlocked !== undefined}
      title={form.askAgainBlocked}
      onClick={() => form.askAgain(onSent)}
    >
      Ask me again
    </Button>
  );
}

/** Ask me again's words: the general comment, sent alone. */
function AskAgainField({
  form,
  autoFocus = false,
}: {
  readonly form: DecisionFormState;
  readonly autoFocus?: boolean;
}): ReactNode {
  return (
    <div className="decision-ask-again-field">
      <Textarea
        label={`What should ${form.asker} explain or change?`}
        hint="Optional."
        rows={2}
        placeholder="Your general comment, sent alone"
        value={form.handle.draft.generalComment}
        disabled={form.disabled}
        autoFocus={autoFocus}
        onChange={(event) => form.handle.setGeneralComment(event.target.value)}
      />
      <p className="decision-hint">
        Sends this comment and no answers. Your picks stay here as a draft until you send;{" "}
        {form.asker} explains and asks again in a new form.
      </p>
    </div>
  );
}

/** The step before Ask me again, in place of the card's actions (spec 4.1). */
function AskAgainStep({ form }: { readonly form: DecisionFormState }): ReactNode {
  return (
    <section className="decision-ask-again" aria-label="Ask me again">
      <AskAgainField form={form} autoFocus />
      {form.sending.error && <AnswerRefused error={form.sending.error} />}
      <div className="decision-actions">
        <ConfirmAskAgainButton form={form} />
        <Button variant="secondary" onClick={() => form.setAskingAgain(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/** Opens the step that asks why; nothing is sent yet. */
export function DismissButton({ dismissal }: { readonly dismissal: Dismissal }): ReactNode {
  return (
    <Button
      variant="secondary"
      iconLeft={<Icon name="circle-x" size={13} />}
      disabled={dismissal.blocked !== undefined}
      title={dismissal.blocked}
      onClick={() => dismissal.setOpen(true)}
    >
      Dismiss
    </Button>
  );
}

function ConfirmDismissButton({
  dismissal,
  onSent,
}: {
  readonly dismissal: Dismissal;
  readonly onSent?: () => void;
}): ReactNode {
  return (
    <Button
      iconLeft={<Icon name="circle-x" size={13} />}
      disabled={dismissal.blocked !== undefined}
      title={dismissal.blocked}
      onClick={() => dismissal.dismiss(onSent)}
    >
      Dismiss
    </Button>
  );
}

/** Dismiss's words: the general comment, sent with the user's next message in the Thread. */
function DismissField({
  dismissal,
  autoFocus = false,
}: {
  readonly dismissal: Dismissal;
  readonly autoFocus?: boolean;
}): ReactNode {
  return (
    <div className="decision-ask-again-field">
      <Textarea
        label="Why dismiss it?"
        hint="Optional."
        rows={2}
        placeholder="Your general comment, sent with your next message"
        value={dismissal.handle.draft.generalComment}
        disabled={dismissal.disabled}
        autoFocus={autoFocus}
        onChange={(event) => dismissal.handle.setGeneralComment(event.target.value)}
      />
      <p className="decision-hint">
        Closes the Decision unanswered. {dismissal.asker} learns of it with your next message in the
        Thread.
      </p>
    </div>
  );
}

/** The step before Dismiss, in place of the card's actions (spec 4.1). */
export function DismissStep({ dismissal }: { readonly dismissal: Dismissal }): ReactNode {
  return (
    <section className="decision-ask-again" aria-label="Dismiss">
      <DismissField dismissal={dismissal} autoFocus />
      {dismissal.error && <AnswerRefused error={dismissal.error} />}
      <div className="decision-actions">
        <ConfirmDismissButton dismissal={dismissal} />
        <Button variant="secondary" onClick={() => dismissal.setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

/**
 * The progress line: how many questions are answered, an untouched recommendation counting, and the
 * way to the first one that isn't.
 */
export function ProgressLine({
  decision,
  draft,
  onJump,
}: {
  readonly decision: Pick<Decision, "questions">;
  readonly draft: DecisionDraft;
  readonly onJump: (index: number) => void;
}): ReactNode {
  const missing = missingAnswer(decision, draft);
  return (
    <div className="decision-progress">
      <span className="decision-progress-meter" aria-hidden="true">
        <ProgressBar
          value={answeredCount(decision, draft)}
          max={Math.max(decision.questions.length, 1)}
          tone="success"
          size="sm"
          valueLabel=""
        />
      </span>
      <span className="decision-progress-words">{progressWords(decision, draft)}</span>
      {missing === undefined ? (
        <span>Ready to submit</span>
      ) : (
        <TextButton className="decision-progress-missing" onClick={() => onJump(missing)}>
          Question {missing + 1} needs an answer
        </TextButton>
      )}
    </div>
  );
}

function questionElementId(formId: string, index: number): string {
  return `${formId}-question-${index}`;
}

/** Brings a question into view and puts the focus on its answer. */
function focusQuestion(elementId: string): void {
  const block = document.getElementById(elementId);
  if (block === null) return;
  block.scrollIntoView?.({ block: "center" });
  // A missing answer is in words: an open question's, a choice's after "None of these", or a choice
  // of several's with no box checked.
  (
    block.querySelector<HTMLElement>("textarea") ?? block.querySelector<HTMLElement>("input")
  )?.focus();
}
