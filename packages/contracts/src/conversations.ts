import { z } from "zod";
import { webEventSchema } from "./events.js";
import { roleCardSchema } from "./people.js";

/** Where a conversation lives: a person's chat, by the Role's key, a Task's or an Initiative's. */
export const homeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), roleKey: z.string() }),
  z.object({ kind: z.literal("task"), taskId: z.string() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.string() }),
]);
export type Home = z.infer<typeof homeSchema>;

/** Whether the person is answering, or the Thread waits for the user's next message. */
export const threadStateSchema = z.enum(["waiting", "answering"]);
export type ThreadState = z.infer<typeof threadStateSchema>;

/** A Thread's tokens over all its turns, split as the engine reports them. */
export const tokenTotalsSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheCreation: z.number().int().nonnegative(),
});
export type TokenTotals = z.infer<typeof tokenTotalsSchema>;

/** The Context policy's moves (spec §2.5). */
export const contextMoveSchema = z.enum(["resume", "fresh", "hand-off"]);
export type ContextMove = z.infer<typeof contextMoveSchema>;

/** Why the policy chose the move, which the Thread's label shows. */
export const contextReasonSchema = z.enum([
  "new-thread",
  "another-person",
  "cache-warm",
  "small-context",
  "cache-expired",
  "session-default",
  "your-choice",
  "stage-declared",
  "context-full",
]);
export type ContextReason = z.infer<typeof contextReasonSchema>;

/** "Start fresh" or "Continue anyway", for the next message only. */
export const contextOverrideSchema = z.enum(["start-fresh", "continue-anyway"]);
export type ContextOverride = z.infer<typeof contextOverrideSchema>;

/** What the Thread's next message does to its session, decided as the Thread is read. */
export const threadContextSchema = z.object({
  move: contextMoveSchema,
  reason: contextReasonSchema,
  cacheWarm: z.boolean(),
  contextTokens: z.number().int().nonnegative(),
  /** The Brief's estimate when the move starts a session with one. */
  briefTokens: z.number().int().nonnegative().nullable(),
  /** What the user may choose instead, with its estimated tokens. */
  alternatives: z.array(
    z.object({ override: contextOverrideSchema, tokens: z.number().int().nonnegative() }),
  ),
  /** What the user chose for the next message, or null for the policy's choice. */
  override: contextOverrideSchema.nullable(),
});
export type ThreadContext = z.infer<typeof threadContextSchema>;

/** GET /threads/:id, and each of a home's Threads. */
export const threadSchema = z.object({
  id: z.uuid(),
  home: homeSchema,
  /** The person the user talks to in it, by the key of the Role they fill. */
  roleKey: z.string(),
  /** From its first message until the user renames it; null before any message. */
  title: z.string().nullable(),
  state: threadStateSchema,
  /** Its ended turns' tokens and the running turn's so far, which its end replaces. */
  tokens: tokenTotalsSchema,
  context: threadContextSchema,
  startedAt: z.iso.datetime(),
  /**
   * An Agent works one of the Task's Stages in it: while it is answering, a message lands at the
   * next safe point instead of waiting for the answer.
   */
  stageThread: z.boolean(),
  /**
   * Set for a Consultation: the sub-thread where a Consultant answers the Decision an Agent put to
   * them. The Thread's `roleKey` is the Consultant; the asker is named here.
   */
  consultation: z
    .object({ decisionId: z.uuid(), askerThreadId: z.uuid(), askerRoleKey: z.string() })
    .nullable(),
});
export type Thread = z.infer<typeof threadSchema>;

/** GET /chats/:roleKey/threads: the newest started first. */
export const threadListSchema = z.array(threadSchema);

/**
 * POST /threads/:id/messages: the user's message, which the person answers; `handoverNoteFrom`
 * when it is the Handover note a Link card gave them, by its writer's Role key.
 */
export const newMessageSchema = z.object({
  text: z.string(),
  handoverNoteFrom: z.string().min(1).optional(),
});
export type NewMessage = z.infer<typeof newMessageSchema>;

/** PUT /threads/:id/context-override: null goes back to the policy's choice. */
export const contextOverrideChoiceSchema = z.object({ override: contextOverrideSchema.nullable() });
export type ContextOverrideChoice = z.infer<typeof contextOverrideChoiceSchema>;

/** PUT /threads/:id/title */
export const threadTitleSchema = z.object({ title: z.string() });
export type ThreadTitle = z.infer<typeof threadTitleSchema>;

/**
 * The Office tool an Agent opens a Decision with. Its tool activity line is hidden in the web,
 * since the Decision's card shows the call.
 */
export const OPEN_DECISION_TOOL = "open_decision";

/**
 * The Office tool an Agent consults a person with. It opens a Decision as `open_decision` does, so
 * its tool activity line is hidden in the web too.
 */
export const CONSULT_TOOL = "consult";

/**
 * The Office tool a Consultant gives their answer with in a Consultation. It answers the Decision
 * the asking Agent waits on, which the Decision's card shows.
 */
export const ANSWER_CONSULTATION_TOOL = "answer_consultation";

/** The Office tools whose calls the Decision card shows, so the web hides their activity lines. */
export const DECISION_TOOLS: readonly string[] = [
  OPEN_DECISION_TOOL,
  CONSULT_TOOL,
  ANSWER_CONSULTATION_TOOL,
];

/** How the user answers a Decision: one of its options, by its index, or a free answer. */
export const decisionAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("option"), option: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("free-answer"), text: z.string() }),
]);
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>;

/**
 * A question an Agent puts to the user in the Thread it works in on a Task, or The Office does
 * about a Task's Pipeline (a Stage that failed with no retries left, the Definition of Done not
 * met), shown there as a card. POST /decisions/:id/answer takes a `decisionAnswerSchema`.
 */
export const decisionSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  taskId: z.string(),
  /** Who asked, by the key of the Role they fill; null when The Office asked. */
  roleKey: z.string().nullable(),
  question: z.string(),
  /** What the user needs to know to decide, as the Agent found it. */
  context: z.string(),
  options: z.array(z.string()).min(2),
  /** The option the Agent recommends, by its index in `options`, and why. */
  recommendation: z.object({ option: z.number().int().nonnegative(), reason: z.string() }),
  askedAt: z.iso.datetime(),
  /**
   * The Consultant it waits on, by the key of their Role, in a Consultation; null while it waits on
   * the user.
   */
  putTo: z.string().nullable(),
  /** The Consultants who passed an approval on, by the key of their Role, the first one first. */
  passedOn: z.array(
    z.object({ roleKey: z.string(), reason: z.string(), passedOnAt: z.iso.datetime() }),
  ),
  /** Null while it waits on the user or the Consultant. */
  answer: decisionAnswerSchema.nullable(),
  answeredAt: z.iso.datetime().nullable(),
  /** The Consultant who answered, by the key of their Role; null when the user did. */
  answeredBy: z.string().nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

/** GET /decisions/open: every Decision waiting on the user, the first asked first. */
export const decisionListSchema = z.array(decisionSchema);

/**
 * The Office tool the Office Manager drafts a Proposal of a Role with. Its tool activity line is
 * hidden in the web, since the Proposal's card shows the call.
 */
export const PROPOSE_ROLE_TOOL = "propose_role";

/** The Office tool the Office Manager drafts a Proposal of an Office setting with, hidden alike. */
export const PROPOSE_OFFICE_SETTING_TOOL = "propose_office_setting";

/** The Office tool the Office Manager posts a Link card with, hidden alike behind the card. */
export const POST_LINK_CARD_TOOL = "post_link_card";

/** The Office tool a chat captures an Idea with, hidden alike behind the Idea's card. */
export const CAPTURE_IDEA_TOOL = "capture_idea";

/** The Office tool the Office Manager shows the Office status with, hidden alike behind its card. */
export const SHOW_OFFICE_STATUS_TOOL = "show_office_status";

/** The fields of a Role card a change rewrites, each one whole; skills aren't among them. */
const roleCardFieldsSchema = roleCardSchema.omit({ skills: true }).partial();

/** What a Proposal changes, by kind; the module that owns each kind applies it. */
export const proposedChangeSchema = z.discriminatedUnion("kind", [
  /** A new Role, hired from scratch on this card (with its skills) when the user applies it. */
  z.object({
    kind: z.literal("hire"),
    card: roleCardSchema,
    /** The Role the person was hired into; null until the user applied it. */
    roleKey: z.string().nullable(),
  }),
  /** A person hired into a preset's Role (`roleKey`, the preset's key) under `name`. */
  z.object({ kind: z.literal("hire-from-preset"), roleKey: z.string(), name: z.string() }),
  /**
   * A change to a hired Role's card: the fields it rewrites as the card had them when drafted, and
   * as proposed. Applying rewrites only those fields on the card as it is then.
   */
  z.object({
    kind: z.literal("change"),
    roleKey: z.string(),
    from: roleCardFieldsSchema,
    to: roleCardFieldsSchema,
  }),
  /** A new Office-wide limit (`to`), and the limit when drafted (`from`); Work applies it. */
  z.object({ kind: z.literal("office-wide-limit"), from: z.number(), to: z.number() }),
  /** A new size threshold, in tokens, and the threshold when drafted. */
  z.object({ kind: z.literal("size-threshold"), from: z.number(), to: z.number() }),
]);
export type ProposedChange = z.infer<typeof proposedChangeSchema>;

/** Open until the user applies or declines it; nothing changes before they apply it. */
export const proposalStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open") }),
  z.object({ kind: z.literal("applied"), at: z.iso.datetime() }),
  z.object({ kind: z.literal("declined"), at: z.iso.datetime() }),
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

/**
 * A change a person drafted for the user to confirm with a click, shown as a card in the Thread it
 * was drafted in. GET /proposals/:id reads one; POST /proposals/:id/apply applies it, taking a
 * `proposalApplicationSchema`, and POST /proposals/:id/decline declines it ("Not now"); both answer
 * with the Proposal as it is then, or a `threadRefusalSchema` that leaves it open.
 */
export const proposalSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  /** Who drafted it, by the key of their Role. */
  draftedBy: z.string(),
  draftedAt: z.iso.datetime(),
  /** As drafted while open; as applied, with the user's edits, once applied. */
  change: proposedChangeSchema,
  status: proposalStatusSchema,
});
export type Proposal = z.infer<typeof proposalSchema>;

/**
 * POST /proposals/:id/apply: a new Role as the user edited it before hiring, from scratch its card
 * (with its skills), from a preset the person's name; neither to apply the Proposal as drafted.
 */
export const proposalApplicationSchema = z
  .object({ card: roleCardSchema.optional(), name: z.string().optional() })
  .refine(({ card, name }) => card === undefined || name === undefined, {
    message: "Give the edited card or the name, not both.",
  });
export type ProposalApplication = z.infer<typeof proposalApplicationSchema>;

const messageFields = { id: z.uuid(), at: z.iso.datetime() };

/**
 * Whether the user's message reached the person: one written into a running Stage Thread waits for
 * the next safe point, and is not delivered when the Stage's session ends first.
 */
export const messageDeliverySchema = z.enum(["waiting", "delivered", "not-delivered"]);
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;

/** A message of The Office's log of a Thread, which is what the UI shows. */
export const messageSchema = z.discriminatedUnion("kind", [
  z.object({
    ...messageFields,
    kind: z.literal("user"),
    text: z.string(),
    delivery: messageDeliverySchema,
    /** Who wrote the Handover note the user sent from a Link card, by their Role's key. */
    handoverNoteFrom: z.string().nullable(),
  }),
  z.object({ ...messageFields, kind: z.literal("person"), roleKey: z.string(), text: z.string() }),
  /** A few lines the person wrote for whoever continues, when The Office asked for them. */
  z.object({
    ...messageFields,
    kind: z.literal("handover-note"),
    roleKey: z.string(),
    text: z.string(),
  }),
  /** Something the person did with a tool, such as reading a file. */
  z.object({
    ...messageFields,
    kind: z.literal("tool-activity"),
    roleKey: z.string(),
    tool: z.string(),
    summary: z.string(),
  }),
  /** The move the Context policy made as the person took a message: The Office's line. */
  z.object({
    ...messageFields,
    kind: z.literal("context"),
    move: contextMoveSchema,
    reason: contextReasonSchema,
    contextTokens: z.number().int().nonnegative(),
    briefTokens: z.number().int().nonnegative().nullable(),
    /** The Brief the session started with, for the user to read; null when it had none. */
    brief: z.string().nullable(),
  }),
  /** Why the person couldn't answer. */
  z.object({ ...messageFields, kind: z.literal("failure"), reason: z.string() }),
  /** The user held the Stage with Pause or Stop, which is no failure: The Office's line. */
  z.object({
    ...messageFields,
    kind: z.literal("held"),
    heldBy: z.enum(["pause", "stop"]),
    text: z.string(),
  }),
  /** A Decision the person opened (The Office, when null), as its card shows it now, answered or not. */
  z.object({
    ...messageFields,
    kind: z.literal("decision"),
    roleKey: z.string().nullable(),
    decision: decisionSchema,
  }),
  /**
   * The user answered the Decision, sending it into the asking session, or to the Task's Pipeline
   * for The Office's and a Stage Thread's: the answer as given, and the Decision as it is now (open
   * again when the answer never reached a session).
   */
  z.object({
    ...messageFields,
    kind: z.literal("decision-answer"),
    answer: decisionAnswerSchema,
    decision: decisionSchema,
  }),
  /** A Proposal the person drafted, as its card shows it now: open, applied or declined. */
  z.object({
    ...messageFields,
    kind: z.literal("proposal"),
    roleKey: z.string(),
    proposal: proposalSchema,
  }),
  /**
   * The Office Manager points the user to a person (`roleKey` posted it), about a Task when it
   * names one, with a Handover note the user may edit or leave out before sending it themselves in
   * a new chat Thread with them. `letGo` is read as the log is.
   */
  z.object({
    ...messageFields,
    kind: z.literal("link-card"),
    roleKey: z.string(),
    to: z.object({ roleKey: z.string(), letGo: z.boolean() }),
    taskId: z.uuid().nullable(),
    note: z.string(),
  }),
  /** An Idea the person captured in the chat (`roleKey`), shown as its card: GET /ideas/:id reads it. */
  z.object({ ...messageFields, kind: z.literal("idea"), roleKey: z.string(), ideaId: z.uuid() }),
  /**
   * The Office Manager (`roleKey`) shows the Office status: Office-wide, who is on what and what
   * waits on the user, read from GET /now whenever the card is shown.
   */
  z.object({ ...messageFields, kind: z.literal("office-status"), roleKey: z.string() }),
  /** A tool call that was refused, with the reason the person read. */
  z.object({
    ...messageFields,
    kind: z.literal("refusal"),
    roleKey: z.string(),
    tool: z.string(),
    reason: z.string(),
  }),
]);
export type Message = z.infer<typeof messageSchema>;

/** GET /threads/:id/messages: in the order they were logged. */
export const messageListSchema = z.array(messageSchema);

/** What a refused Thread change answers: every reason, also joined into Nest's `message`. */
export const threadRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type ThreadRefusal = z.infer<typeof threadRefusalSchema>;

/** The Context policy's size threshold, in tokens, as Settings › Office limits steps it. */
export const SIZE_THRESHOLD_TOKENS = { min: 5_000, max: 200_000, step: 5_000 } as const;

/**
 * Above this much context added since a session's first turn, a cooled Thread starts fresh
 * (spec §2.5).
 */
export const sizeThresholdSchema = z.object({
  sizeThreshold: z
    .int()
    .min(SIZE_THRESHOLD_TOKENS.min)
    .max(SIZE_THRESHOLD_TOKENS.max)
    .multipleOf(SIZE_THRESHOLD_TOKENS.step),
});
export type SizeThreshold = z.infer<typeof sizeThresholdSchema>;

const threadWebEventFields = { threadId: z.uuid(), home: homeSchema };
const decisionWebEventFields = { ...threadWebEventFields, decisionId: z.uuid() };
const proposalWebEventFields = { ...threadWebEventFields, proposalId: z.uuid() };

/**
 * The Conversations events the web receives; each names the Thread and its home, but the size
 * threshold's change, which touches every Thread's label.
 */
export const threadWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("thread.started"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.renamed"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.messages-logged"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.turn-ended"), ...threadWebEventFields }),
  /** The running turn counted more tokens: the Thread's tokens now, as GET /threads/:id has them. */
  webEventSchema.extend({
    type: z.literal("thread.tokens-counted"),
    ...threadWebEventFields,
    tokens: tokenTotalsSchema,
  }),
  webEventSchema.extend({ type: z.literal("thread.delivery-marked"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.override-chosen"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.decision-opened"), ...decisionWebEventFields }),
  webEventSchema.extend({
    type: z.literal("thread.decision-answered"),
    ...decisionWebEventFields,
  }),
  /** The session the answer went to never started: the Decision waits on the user again. */
  webEventSchema.extend({
    type: z.literal("thread.decision-reopened"),
    ...decisionWebEventFields,
  }),
  webEventSchema.extend({
    type: z.literal("thread.proposal-drafted"),
    ...proposalWebEventFields,
  }),
  webEventSchema.extend({
    type: z.literal("thread.proposal-applied"),
    ...proposalWebEventFields,
  }),
  webEventSchema.extend({
    type: z.literal("thread.proposal-declined"),
    ...proposalWebEventFields,
  }),
  webEventSchema.extend({ type: z.literal("context-policy.size-threshold-changed") }),
]);
export type ThreadWebEvent = z.infer<typeof threadWebEventSchema>;
