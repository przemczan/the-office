import { z } from "zod";
import { webEventSchema } from "./events.js";
import { openPageSchema } from "./open-page.js";
import { roleCardSchema } from "./people.js";
import { newProjectSchema, proposedProjectCommandsSchema } from "./projects.js";
import { pinnedVersionSchema } from "./skills.js";
import { stageChangeSchema, stageSchema } from "./stages.js";
import { prioritySchema } from "./work.js";

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

/** Tokens over all a Thread's turns, a Stage's runs or a day, split as the engine reports them. */
export const tokenTotalsSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheCreation: z.number().int().nonnegative(),
});
export type TokenTotals = z.infer<typeof tokenTotalsSchema>;

/**
 * The tokens every count in The Office shows: input, output and cache writes. Cache reads are left
 * out: they cost about a tenth of input, yet are most of a long session's tokens (spec 2.7,
 * "Today's figures").
 */
export function countedTokens({ input, output, cacheCreation }: TokenTotals): number {
  return input + output + cacheCreation;
}

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
  "engine-changed",
  "changes-switched",
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
  /** When the warm cache goes cold, which the UI counts down to; null while it isn't warm. */
  cacheWarmUntil: z.iso.datetime().nullable(),
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
    .object({
      decisionId: z.uuid(),
      askerThreadId: z.uuid(),
      /** Null when The Office asked, as when a Stage failed (spec §2.3). */
      askerRoleKey: z.string().nullable(),
    })
    .nullable(),
  /**
   * Whether changes are allowed in it: the Caretaker reaches the whole workstation but secrets
   * (spec §2.4). Null for every Thread but the Caretaker's chat's, where there is no such switch.
   */
  changesAllowed: z.boolean().nullable(),
  /**
   * The person has answered and the user hasn't seen it (spec §2.4). Null outside a chat, which
   * takes no part in the record of what the user has seen.
   */
  answered: z.boolean().nullable(),
  /** Its newest message's time, or when it started while it has none. Null outside a chat. */
  lastMovedAt: z.iso.datetime().nullable(),
});
export type Thread = z.infer<typeof threadSchema>;

/** A Consultation on the Task, shown above the Consultant's Thread in their tab. */
export const tabConsultationSchema = z.object({
  threadId: z.uuid(),
  decisionId: z.uuid(),
  question: z.string(),
  /** The Consultant's answer, in words; null while the Consultation waits on them. */
  note: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
});
export type TabConsultation = z.infer<typeof tabConsultationSchema>;

/** One person's tab in a Task's conversation (spec §2.4). */
export const conversationTabSchema = z.object({
  roleKey: z.string(),
  /** Their one Thread on the Task; null until it is opened. */
  threadId: z.uuid().nullable(),
  /** Their Stage runs now: the tab has a live dot and leads to the Stage history. */
  stageRunning: z.boolean(),
  /** In the order answered; none for anyone who answered no Decision on the Task. */
  consultations: z.array(tabConsultationSchema),
  /**
   * On the Planner's tab while the Task is planned in its Initiative's planning Thread, which counts
   * as its planning Thread: the tab links to it, and no Thread of the Planner's opens on the Task.
   */
  planningThreadElsewhere: z.object({ initiativeId: z.uuid(), threadId: z.uuid() }).nullable(),
});
export type ConversationTab = z.infer<typeof conversationTabSchema>;

/**
 * GET /tasks/:taskId/conversation: the Planner, then each person who ran an Agent Stage in the
 * order they first worked, then each Consultant who answered a Decision on the Task.
 */
export const taskConversationSchema = z.object({ tabs: z.array(conversationTabSchema) });
export type TaskConversation = z.infer<typeof taskConversationSchema>;

/** GET /tasks/:taskId/conversation/:roleKey/brief: what a tab with no Thread would start on. */
export const firstBriefSchema = z.object({ tokens: z.number().int().nonnegative() });
export type FirstBrief = z.infer<typeof firstBriefSchema>;

/** GET /chats/:roleKey/threads: the newest started first. */
export const threadListSchema = z.array(threadSchema);

/** PUT /threads/:id/seen: the newest message of the chat Thread the web has shown. */
export const threadSeenSchema = z.object({ messageId: z.uuid() });
export type ThreadSeen = z.infer<typeof threadSeenSchema>;

/**
 * GET /chats/activity: where each person's chat stands (spec §2.4); someone with no Threads isn't
 * listed.
 */
export const chatActivitySchema = z.array(
  z.object({
    roleKey: z.string(),
    /** In any of their chat's Threads. */
    answering: z.boolean(),
    /** The Threads whose answer the user hasn't seen, the newest answer first. */
    answered: z.array(z.object({ threadId: z.uuid(), at: z.iso.datetime() })),
    lastMovedAt: z.iso.datetime(),
  }),
);
export type ChatActivity = z.infer<typeof chatActivitySchema>;

/**
 * GET /people-working: who is working on each Task right now, by the keys of their Roles, each
 * once; a Task with nobody working isn't listed.
 */
export const peopleWorkingSchema = z.array(
  z.object({ taskId: z.uuid(), roleKeys: z.array(z.string()) }),
);
export type PeopleWorking = z.infer<typeof peopleWorkingSchema>;

/**
 * POST /threads/:id/messages: the user's message, which the person answers; `handoverNoteFrom`
 * when it is the Handover note a Link card gave them, by its writer's Role key; `openPage` when it
 * was sent from the chat drawer beside a record's page.
 */
export const newMessageSchema = z.object({
  text: z.string(),
  handoverNoteFrom: z.string().min(1).optional(),
  openPage: openPageSchema.optional(),
});
export type NewMessage = z.infer<typeof newMessageSchema>;

/** PUT /threads/:id/context-override: null goes back to the policy's choice. */
export const contextOverrideChoiceSchema = z.object({ override: contextOverrideSchema.nullable() });
export type ContextOverrideChoice = z.infer<typeof contextOverrideChoiceSchema>;

/** PUT /threads/:id/title */
export const threadTitleSchema = z.object({ title: z.string() });
export type ThreadTitle = z.infer<typeof threadTitleSchema>;

/**
 * GET /fire-alarm/lifts, and what PUT and DELETE /fire-alarm/lifts/:threadId answer (spec §2.8):
 * the Threads whose Agent may act while the fire alarm is on; none while it is off.
 */
export const fireAlarmLiftsSchema = z.object({ threadIds: z.array(z.uuid()) });
export type FireAlarmLifts = z.infer<typeof fireAlarmLiftsSchema>;

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

/**
 * The Office tool a person answers a Decision waiting on the user with, for the user, when the user
 * asks them to in a Thread of the person's own. Its activity line shows in that Thread, where the
 * Decision has no card.
 */
export const ANSWER_DECISION_TOOL = "answer_decision";

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
 * The person who answered a Decision for the user, when the user asked them to: by the key of their
 * Role, and the Thread the user asked them in.
 */
export const atUsersRequestSchema = z.object({ roleKey: z.string(), threadId: z.uuid() });
export type AtUsersRequest = z.infer<typeof atUsersRequestSchema>;

/**
 * What a Decision asks (spec §2.2): a question with options, approval of a call past a Hard switch,
 * or a request, asking a person to do something, answered in their own words.
 */
export const decisionKindSchema = z.enum(["question", "approval", "request"]);
export type DecisionKind = z.infer<typeof decisionKindSchema>;

/**
 * A question an Agent puts to the user in the Thread it works in on a Task, or The Office does
 * about a Task's Pipeline (a Stage that failed with no retries left, the Definition of Done not
 * met), or a call a person puts to another from a chat, shown there as a card. POST
 * /decisions/:id/answer takes a `decisionAnswerSchema`.
 */
export const decisionSchema = z.object({
  id: z.uuid(),
  threadId: z.uuid(),
  kind: decisionKindSchema,
  /** Null for a call made from a chat, which is on no Task. */
  taskId: z.string().nullable(),
  /** Who asked, by the key of the Role they fill; null when The Office asked. */
  roleKey: z.string().nullable(),
  /** The question; for a request, what the asker asks to be done. */
  question: z.string(),
  /** What the user needs to know to decide, as the Agent found it. */
  context: z.string(),
  /** Two or more; none for a request. */
  options: z.array(z.string()),
  /**
   * The option the Agent recommends, by its index in `options`, and why; for a request, why the
   * asker needs it, its `option` pointing at nothing.
   */
  recommendation: z.object({ option: z.number().int().nonnegative(), reason: z.string() }),
  /**
   * The Task's Attachments it is about, of any kind, by their ids. One removed since no longer shows
   * among the Task's, while the id stays here.
   */
  attachmentIds: z.array(z.string()),
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
  /** The person who answered for the user, at their request; null when nobody did. */
  atUsersRequest: atUsersRequestSchema.nullable(),
  /**
   * The Office answered a call made from a chat that fell back to the user, telling the caller to
   * ask them, as a chat has no Needs you.
   */
  answeredByTheOffice: z.boolean(),
});
export type Decision = z.infer<typeof decisionSchema>;

/**
 * GET /decisions/open: every Decision waiting on the user, the first asked first. GET
 * /tasks/:taskId/decisions/unanswered: the Task's nobody has answered, those put to a Consultant too.
 */
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

/** The Office tool Devops drafts a Proposal of a Project's commands with, hidden alike. */
export const PROPOSE_PROJECT_COMMANDS_TOOL = "propose_project_commands";

/** The Office tool Devops drafts a Proposal of a library Pipeline's Stages with, hidden alike. */
export const PROPOSE_LIBRARY_PIPELINE_TOOL = "propose_library_pipeline";

/** The Office tool Devops drafts a Proposal of a Project Pipeline with, hidden alike. */
export const PROPOSE_PROJECT_PIPELINE_TOOL = "propose_project_pipeline";

/** The Office tool Devops drafts a Proposal of a Stage template's Stage with, hidden alike. */
export const PROPOSE_STAGE_TEMPLATE_TOOL = "propose_stage_template";

/** The Office tool Devops drafts a Project to onboard with, hidden alike behind its card. */
export const PROPOSE_PROJECT_TOOL = "propose_project";

/** The Office tool Devops drafts installing a skill from a Source with, hidden alike. */
export const PROPOSE_SKILL_INSTALL_TOOL = "propose_skill_install";

/** The Office tool Devops drafts an installed skill's update with, hidden alike. */
export const PROPOSE_SKILL_UPDATE_TOOL = "propose_skill_update";

/** The Office tool anyone drafts a written skill with in their chat, hidden alike. */
export const PROPOSE_SKILL_TOOL = "propose_skill";

/** The fields of a Role card a change rewrites, each one whole; skills aren't among them. */
const roleCardFieldsSchema = roleCardSchema.omit({ skills: true }).partial();

/**
 * What a Proposal of a Project Pipeline gives it: its name, description, base Pipeline (an
 * office-wide one's id) and Stage changes, the whole ordered list.
 */
export const projectPipelineFieldsSchema = z.object({
  name: z.string(),
  description: z.string(),
  basePipelineId: z.string(),
  stageChanges: z.array(stageChangeSchema),
});
export type ProjectPipelineFields = z.infer<typeof projectPipelineFieldsSchema>;

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
  /** New Office instructions, whole, and the text when drafted; `to` empty would empty them. */
  z.object({ kind: z.literal("office-instructions"), from: z.string(), to: z.string() }),
  /** A change the CTO wants to an active Initiative; Work applies it. */
  z.object({
    kind: z.literal("initiative"),
    initiativeId: z.uuid(),
    edit: z.discriminatedUnion("kind", [
      /** Its new outcome, whole. */
      z.object({ kind: z.literal("outcome"), outcome: z.string() }),
      /**
       * A new Task in Backlog in one Project, waiting from the start for the Tasks `blockedBy`
       * names; `taskId` is null until the user applied it.
       */
      z.object({
        kind: z.literal("add-task"),
        title: z.string(),
        projectId: z.string(),
        priority: prioritySchema,
        description: z.string(),
        blockedBy: z.array(z.uuid()),
        taskId: z.uuid().nullable(),
      }),
      /** One of its Tasks (`taskId`) made to wait for any Task (`blockerId`). */
      z.object({ kind: z.literal("add-dependency"), taskId: z.uuid(), blockerId: z.uuid() }),
      z.object({ kind: z.literal("remove-dependency"), taskId: z.uuid(), blockerId: z.uuid() }),
      /** One of its Tasks (`taskId`) under a new title, or with a new Description, whole. */
      z.object({ kind: z.literal("task-title"), taskId: z.uuid(), title: z.string() }),
      z.object({ kind: z.literal("task-description"), taskId: z.uuid(), description: z.string() }),
      /**
       * Another Pipeline as the Initiative's Pipeline in one Project it spans; null is None, which
       * applying refuses, as whether a Project has one was fixed at Confirm.
       */
      z.object({
        kind: z.literal("pipeline"),
        projectId: z.string(),
        pipelineId: z.string().nullable(),
      }),
    ]),
  }),
  /**
   * Devops' change to a Project's install command, install inputs and commands: each field now and
   * as proposed. Applying is refused once one changed.
   */
  z.object({
    kind: z.literal("project-commands"),
    projectId: z.string(),
    changes: proposedProjectCommandsSchema,
  }),
  /**
   * Devops' new Stages for a library Pipeline, and its Stages when drafted (now). Applying is
   * refused once they changed.
   */
  z.object({
    kind: z.literal("pipeline"),
    pipelineId: z.string(),
    from: z.array(stageSchema),
    to: z.array(stageSchema),
  }),
  /**
   * Devops' new Stage for a Stage template, and its Stage when drafted (now). Applying is refused
   * once it changed.
   */
  z.object({
    kind: z.literal("stage-template"),
    templateId: z.string(),
    from: stageSchema,
    to: stageSchema,
  }),
  /**
   * Devops' new Project Pipeline of a Project (`from` null), or its change to one: its fields when
   * drafted and as proposed. `pipelineId` is null for a new one until the user applied it. Applying
   * is refused once one changed; it never sets the Project's default.
   */
  z.object({
    kind: z.literal("project-pipeline"),
    projectId: z.string(),
    pipelineId: z.string().nullable(),
    from: projectPipelineFieldsSchema.nullable(),
    to: projectPipelineFieldsSchema,
  }),
  /**
   * A Project Devops drafted to onboard: applying it adds the Project and its Onboard Task, Ready
   * on the Onboard Pipeline. Both ids are null until the user applied it. A repository on a host
   * has its `repositoryUrl`, and `path` is the folder applying it clones it into.
   */
  z.object({
    kind: z.literal("project"),
    project: newProjectSchema,
    projectId: z.string().nullable(),
    taskId: z.uuid().nullable(),
  }),
  /**
   * A skill Devops drafted to install from a Source: the one in `folder` (empty for the top) of
   * `repository` at its pinned version, with its name, description and files' paths as read when
   * drafted. Applying fetches it into the library, off until reviewed.
   */
  z.object({
    kind: z.literal("skill-install"),
    repository: z.string(),
    folder: z.string(),
    pinnedVersion: pinnedVersionSchema,
    name: z.string(),
    description: z.string(),
    files: z.array(z.string()),
    filesHash: z.string(),
  }),
  /**
   * An installed skill's update Devops drafted with notes: from the pinned version it had to its
   * Source's newer one, with its files' paths there. GET /skills/:name/update-diff shows the diff
   * while it is open; applying pins the skill at `to`, on or off as it was, refused once it moved
   * off `from`, and keeps the diff as `appliedDiff` (null before, and for one applied before it was
   * kept).
   */
  z.object({
    kind: z.literal("skill-update"),
    name: z.string(),
    repository: z.string(),
    folder: z.string(),
    from: pinnedVersionSchema,
    to: pinnedVersionSchema,
    notes: z.string(),
    files: z.array(z.string()),
    filesHash: z.string(),
    appliedDiff: z.object({ diff: z.string(), diffCut: z.boolean() }).nullable(),
  }),
  /**
   * A written skill someone drafted in their chat: applying adds it as the Write form does, off
   * until the user has reviewed it.
   */
  z.object({
    kind: z.literal("skill"),
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
  }),
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

/** GET /proposals/open: every open Proposal, in any Thread, the newest first. */
export const proposalListSchema = z.array(proposalSchema);

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
    /** The page open beside the chat drawer as the user sent it, if any. */
    openPage: openPageSchema.nullable(),
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
  /** The user allowed changes in the Caretaker's Thread, or switched them off: The Office's line. */
  z.object({ ...messageFields, kind: z.literal("changes-allowed"), allowed: z.boolean() }),
  /** Why the person couldn't answer. */
  z.object({ ...messageFields, kind: z.literal("failure"), reason: z.string() }),
  /**
   * The engine refused the person's turn as a usage window of its account is used up, until
   * `resetsAt`: The Office's notice, no failure. `window` is the engine's window by the port's name
   * (`five-hour`, `seven-day`, …), or the engine's own name for one the port doesn't name.
   */
  z.object({
    ...messageFields,
    kind: z.literal("usage-window-used-up"),
    engineName: z.string(),
    window: z.string(),
    resetsAt: z.iso.datetime(),
  }),
  /**
   * The user held the Stage with Pause or Stop, the fire alarm held it, or a used-up usage window
   * did, which is no failure: The Office's line.
   */
  z.object({
    ...messageFields,
    kind: z.literal("held"),
    heldBy: z.enum(["pause", "stop", "alarm", "usage-window"]),
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
   * again when the answer never reached a session). `atUsersRequest` names the person who gave it
   * for the user; null when the user did.
   */
  z.object({
    ...messageFields,
    kind: z.literal("decision-answer"),
    answer: decisionAnswerSchema,
    atUsersRequest: atUsersRequestSchema.nullable(),
    decision: decisionSchema,
  }),
  /**
   * The Office's line in a Consultation: what was asked as it opened, such as "Angela asks you to:
   * …", and the Consultant's answer once it reached the asker, such as "Your answer to Angela: …".
   */
  z.object({
    ...messageFields,
    kind: z.literal("consultation-line"),
    decisionId: z.uuid(),
    text: z.string(),
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
  /**
   * One of the session's MCP servers didn't start: The Office's line, with why (every Server value
   * replaced), or null when the engine doesn't say.
   */
  z.object({
    ...messageFields,
    kind: z.literal("mcp-server-not-started"),
    server: z.string(),
    reason: z.string().nullable(),
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

/** About 5k tokens, which every session carries. */
export const OFFICE_INSTRUCTIONS_MAX_CHARACTERS = 20_000;

/**
 * The text every new session gets (spec §2.2). Trimmed, so a blank text saves as empty and adds
 * nothing to a session; the lines inside it stay as written.
 */
export const officeInstructionsSchema = z.object({
  officeInstructions: z.string().trim().max(OFFICE_INSTRUCTIONS_MAX_CHARACTERS),
});
export type OfficeInstructions = z.infer<typeof officeInstructionsSchema>;

/**
 * How a Sub-agent or a Process ended (spec 2.9): stopped by the Agent's TaskStop, an interrupt, the
 * session's end, or no longer seen after The Office restarted.
 */
export const endingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("finished") }),
  z.object({ state: z.literal("failed"), reason: z.string() }),
  z.object({
    state: z.literal("stopped"),
    by: z.enum(["agent", "interrupt", "session-end", "restart"]),
  }),
]);
export type Ending = z.infer<typeof endingSchema>;

export const subAgentOrProcessStateSchema = z.enum(["running", "finished", "failed", "stopped"]);
export type SubAgentOrProcessState = z.infer<typeof subAgentOrProcessStateSchema>;

const subAgentOrProcessFields = {
  /** The id of the tool call that started it; its messages name it as `withinToolCall`. */
  callId: z.string(),
  /** The engine's own id, which TaskStop names, once the engine gave it. */
  engineTaskId: z.string().nullable(),
  /** The Sub-agent that started it, by its `callId`; null for the session's Agent. */
  startedBy: z.string().nullable(),
  description: z.string(),
  state: subAgentOrProcessStateSchema,
  ending: endingSchema.nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** Counts its changes: of two copies, the one with the higher revision is newer. */
  revision: z.number().int().nonnegative(),
  /** The sequence of its last message or output chunk; 0 before the first. */
  lastSequence: z.number().int().nonnegative(),
};

export const subAgentSchema = z.object({
  kind: z.literal("sub-agent"),
  ...subAgentOrProcessFields,
  /** Such as "general-purpose" or "Explore". */
  agentKind: z.string().nullable(),
  prompt: z.string(),
  background: z.boolean(),
  reportedBack: z.string().nullable(),
  toolCallCount: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  /** How many of its earliest messages and tool calls aren't kept. */
  earlierMessagesNotKept: z.number().int().nonnegative(),
});
export type SubAgent = z.infer<typeof subAgentSchema>;

export const processSchema = z.object({
  kind: z.literal("process"),
  ...subAgentOrProcessFields,
  commandLine: z.string(),
  /** Null when the engine gives none (Claude Code). */
  exitCode: z.number().int().nullable(),
  /** How many bytes of its earliest output aren't kept. */
  earlierOutputNotKept: z.number().int().nonnegative(),
});
export type Process = z.infer<typeof processSchema>;

export const subAgentOrProcessSchema = z.discriminatedUnion("kind", [
  subAgentSchema,
  processSchema,
]);
export type SubAgentOrProcess = z.infer<typeof subAgentOrProcessSchema>;

/** GET /threads/:id/sub-agents-and-processes: the Thread's current session's, as they started. */
export const subAgentsAndProcessesSchema = z.array(subAgentOrProcessSchema);

/** `?after=<sequence>` of the two reads: what came after it; 0, or left out, reads all kept. */
export const afterSequenceQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
});
export type AfterSequenceQuery = z.infer<typeof afterSequenceQuerySchema>;

const sequenced = { sequence: z.number().int().positive(), at: z.iso.datetime() };

/** A Sub-agent's message or tool call, as a Thread logs its Agent's. */
export const subAgentMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), ...sequenced, text: z.string() }),
  z.object({
    kind: z.literal("tool-activity"),
    ...sequenced,
    tool: z.string(),
    summary: z.string(),
  }),
  z.object({ kind: z.literal("refusal"), ...sequenced, tool: z.string(), reason: z.string() }),
]);
export type SubAgentMessage = z.infer<typeof subAgentMessageSchema>;

/** GET /threads/:id/sub-agents/:callId/messages?after=: those after `after`, up to `lastSequence`. */
export const subAgentMessagesSchema = z.object({
  messages: z.array(subAgentMessageSchema),
  lastSequence: z.number().int().nonnegative(),
  earlierNotKept: z.number().int().nonnegative(),
});
export type SubAgentMessages = z.infer<typeof subAgentMessagesSchema>;

/** A Process's output as it came, in whole lines, masked. */
export const outputChunkSchema = z.object({
  sequence: z.number().int().positive(),
  text: z.string(),
});
export type OutputChunk = z.infer<typeof outputChunkSchema>;

/** GET /threads/:id/processes/:callId/output?after=: what came after `after`, up to `lastSequence`. */
export const processOutputSchema = z.object({
  chunks: z.array(outputChunkSchema),
  lastSequence: z.number().int().nonnegative(),
  /** In bytes: "1.9 MB of earlier output isn't kept". */
  earlierNotKept: z.number().int().nonnegative(),
});
export type ProcessOutput = z.infer<typeof processOutputSchema>;

/**
 * The list with `item` put in by its `callId`, whatever order start, change and end events come
 * in: an older copy never replaces a newer one, and an ended item never goes back to Running.
 */
export function withSubAgentOrProcess(
  list: readonly SubAgentOrProcess[],
  item: SubAgentOrProcess,
): SubAgentOrProcess[] {
  const index = list.findIndex(({ callId }) => callId === item.callId);
  if (index === -1) return [...list, item];
  const kept = list[index];
  if (kept === undefined || !isNewer(item, kept)) return [...list];
  return list.map((each, at) => (at === index ? item : each));
}

function isNewer(item: SubAgentOrProcess, than: SubAgentOrProcess): boolean {
  if (than.state !== "running" && item.state === "running") return false;
  if (than.state === "running" && item.state !== "running") return true;
  return item.revision > than.revision;
}

const threadWebEventFields = { threadId: z.uuid(), home: homeSchema };
const decisionWebEventFields = { ...threadWebEventFields, decisionId: z.uuid() };
const proposalWebEventFields = { ...threadWebEventFields, proposalId: z.uuid() };

/**
 * The Conversations events the web receives; each names the Thread and its home, but the size
 * threshold's change, which touches every Thread's label, and the Office instructions' change.
 */
export const threadWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("thread.started"), ...threadWebEventFields }),
  webEventSchema.extend({ type: z.literal("thread.renamed"), ...threadWebEventFields }),
  /** The user saw more of a chat Thread, in one tab: the others update what they show as answered. */
  webEventSchema.extend({ type: z.literal("thread.seen"), ...threadWebEventFields }),
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
  /** Each carries the whole item, which the page puts in its list (`withSubAgentOrProcess`). */
  webEventSchema.extend({
    type: z.literal("thread.sub-agent-started"),
    ...threadWebEventFields,
    item: subAgentSchema,
  }),
  webEventSchema.extend({
    type: z.literal("thread.sub-agent-changed"),
    ...threadWebEventFields,
    item: subAgentSchema,
  }),
  webEventSchema.extend({
    type: z.literal("thread.sub-agent-ended"),
    ...threadWebEventFields,
    item: subAgentSchema,
  }),
  webEventSchema.extend({
    type: z.literal("thread.process-started"),
    ...threadWebEventFields,
    item: processSchema,
  }),
  webEventSchema.extend({
    type: z.literal("thread.process-ended"),
    ...threadWebEventFields,
    item: processSchema,
  }),
  /**
   * A Sub-agent's new messages and tool calls, each with its sequence: sent only to a subscription
   * scoped to the Thread (`THREAD_SCOPED_EVENT_TYPES`).
   */
  webEventSchema.extend({
    type: z.literal("thread.sub-agent-messages"),
    ...threadWebEventFields,
    callId: z.string(),
    messages: z.array(subAgentMessageSchema),
  }),
  /** A Process's new output chunk with its sequence, scoped to the Thread as the messages are. */
  webEventSchema.extend({
    type: z.literal("thread.process-output"),
    ...threadWebEventFields,
    callId: z.string(),
    chunk: outputChunkSchema,
  }),
  webEventSchema.extend({ type: z.literal("context-policy.size-threshold-changed") }),
  webEventSchema.extend({ type: z.literal("office-instructions.changed") }),
]);
export type ThreadWebEvent = z.infer<typeof threadWebEventSchema>;
