import { z } from "zod";
import { homeSchema } from "./conversations.js";
import { webEventSchema } from "./events.js";

/**
 * A person's headline state on the Live view, for drawing: waiting on you leads, then consulting,
 * then working; idle only with nothing else.
 */
export const liveViewStateSchema = z.enum(["working", "consulting", "waiting-on-you", "idle"]);
export type LiveViewState = z.infer<typeof liveViewStateSchema>;

/**
 * One of the person's Agents: a session answering now in a Thread. A Consultation's carries the
 * Decision it answers and who asked it, null when The Office did.
 */
export const liveAgentSchema = z.object({
  threadId: z.uuid(),
  home: homeSchema,
  kind: z.enum(["stage", "thread", "consultation"]),
  consultation: z.object({ decisionId: z.uuid(), askerRoleKey: z.string().nullable() }).nullable(),
  /**
   * The engine its session runs on, by name; `standInFor` names the cascade's engine it stands in
   * for as a Stand-in Engine, and why, null on the cascade's. Null for a session not yet opened.
   */
  engine: z
    .object({
      engineId: z.string(),
      engineName: z.string(),
      standInFor: z
        .object({ engineId: z.string(), engineName: z.string(), reason: z.string() })
        .nullable(),
    })
    .nullable(),
});
export type LiveAgent = z.infer<typeof liveAgentSchema>;

/** A Decision of the person's put to a Consultant, who answers it now. */
export const liveConsultingSchema = z.object({
  decisionId: z.uuid(),
  /** The Thread the Decision was asked in. */
  threadId: z.uuid(),
  home: homeSchema,
  consultantRoleKey: z.string(),
  question: z.string(),
  since: z.iso.datetime(),
});
export type LiveConsulting = z.infer<typeof liveConsultingSchema>;

/**
 * A Decision in the person's Thread waiting on the user; `byTheOffice` when The Office asked it, as
 * for a Stage out of tries.
 */
export const liveWaitingOnYouSchema = z.object({
  decisionId: z.uuid(),
  threadId: z.uuid(),
  home: homeSchema,
  byTheOffice: z.boolean(),
  question: z.string(),
  since: z.iso.datetime(),
});
export type LiveWaitingOnYou = z.infer<typeof liveWaitingOnYouSchema>;

/** What one person of The Office is doing now, every activity listed. */
export const livePersonSchema = z.object({
  roleKey: z.string(),
  name: z.string(),
  title: z.string(),
  state: liveViewStateSchema,
  /** One lit monitor each. */
  agents: z.array(liveAgentSchema),
  consulting: z.array(liveConsultingSchema),
  waitingOnYou: z.array(liveWaitingOnYouSchema),
  /** Set only when the state is idle. */
  idleSince: z.iso.datetime().nullable(),
});
export type LivePerson = z.infer<typeof livePersonSchema>;

/**
 * GET /live-view: everyone filling a Role now, in hiring order. A key that joins is someone hired
 * or hired back; one that leaves is someone let go.
 */
export const liveViewSchema = z.object({ people: z.array(livePersonSchema) });
export type LiveView = z.infer<typeof liveViewSchema>;

/** The whole snapshot, sent whenever it differs from the last one sent. */
export const liveViewWebEventSchema = webEventSchema.extend({
  type: z.literal("live-view.changed"),
  liveView: liveViewSchema,
});
export type LiveViewWebEvent = z.infer<typeof liveViewWebEventSchema>;
