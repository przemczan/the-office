import type { z } from "zod";

/** The session's Office rules' decision on a command line: run it, or refuse it in these words. */
export type CommandJudgement =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** The session an Office tool is called from, so the tool can tell whose work it acts on. */
export interface OfficeToolCall {
  readonly sessionId: string;
  /**
   * A folder of the session's own that its Office rules let it read, for files a tool writes for
   * it to read, such as a command's output. It may not exist yet; it is removed with the session.
   */
  readonly outputFolder: string;
  /**
   * The session's Office rules' decision on `commandLine` as its own Bash call in its folder: its
   * profile, git, the container runtime and the secrets, and any hold on its calls, as the engine's
   * hook would decide it. For a tool that runs a command line the Agent wrote.
   */
  judgeCommand(commandLine: string): Promise<CommandJudgement>;
  /**
   * The user whose Allow once let this call run, when the ruling step held it for approval: the
   * tool records them beside the person on the change it makes.
   */
  readonly allowedBy?: OfficeToolUser;
}

/** A user as an Office tool's change records them: their id and their name as it was then. */
export interface OfficeToolUser {
  readonly userId: string;
  readonly name: string;
}

/** A picture an Office tool answers with, such as an image Attachment. */
export interface OfficeToolPicture {
  /** What the picture is called, for the words an engine answers in its place. */
  readonly name: string;
  /** One of the image types the model reads: PNG, JPEG, GIF or WebP. */
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/**
 * What an Office tool answers the Agent: words, and pictures for the model to see. Each engine
 * adapter gives the pictures its own way, or says in words why it can't.
 */
export interface OfficeToolResult {
  readonly text: string;
  /** Whether the call failed; the Agent reads `text` either way. */
  readonly isError: boolean;
  readonly pictures?: readonly OfficeToolPicture[];
}

/** What the ruling step reads of an Office action's tool to rule a call (spec 5.4.1). */
export interface OfficeToolAuthority {
  /** The key of the Authority group that rules the tool, from the catalog the contracts hold. */
  readonly group: string;
  /**
   * The single tool whose setting rules a call on the person's own work instead of `group`, such
   * as Continue at a Gate on own work; undefined when `group` rules every call.
   */
  readonly onOwnWork?: string;
  /** What the action is called as the user reads it, such as "Start a Task". */
  readonly title: string;
  /** The subject a call with this input changes, so own work is told from others'. */
  subject(input: unknown): OfficeToolSubject;
  /**
   * The tool's own refusal of a call, in the words the Agent reads, or undefined when it may go on.
   * The ruling step asks it before it runs or holds a call, so no approval is spent on a call refused
   * up front, and again on the repeat after Allow once. It only reads what the refusal needs.
   */
  check?(input: unknown, call: OfficeToolCall): Promise<string | undefined>;
  /**
   * "proposal" when the call may run no more freely than as a Proposal whatever the person's
   * Authority says (an Allowed value is read as Proposal; Ask me, Consult and Never are kept), such as
   * a change to an active Initiative (spec 2.1.4); undefined when Authority alone rules it. It only
   * reads.
   */
  floor?(input: unknown): Promise<"proposal" | undefined>;
  /**
   * What a call changes, one plain line each, as the approval card lists them; the call's input is
   * shown instead when the tool has none. It only reads, and names Secret variables by name only.
   */
  approvalLines?(input: unknown, call: OfficeToolCall): Promise<readonly string[]>;
}

/** The record a call changes, by its kind and id. */
export interface OfficeToolSubject {
  readonly kind: string;
  readonly id: string;
}

/** One field a call changes, as a card lists it (spec 5.4.1 › Office actions). */
export interface OfficeToolChangedField {
  readonly label: string;
  /** The value now; null when it has none, and always for a Secret value, which is named only. */
  readonly before: string | null;
  /** The value the call gives it; null as for `before`. */
  readonly after: string | null;
  /** A short value on a line, a long text shown as a diff, or a Secret value, by its name only. */
  readonly form: "short" | "long" | "secret";
}

/**
 * What a call of an Office action changes, read now: the record it acts on as the user reads it,
 * each field it changes, and the source of its fingerprint, which is every field its handler reads to
 * decide and writes (a move reads the Task's state too), so a change to any of them since the draft
 * is a change to the subject.
 */
export interface OfficeToolDraft {
  readonly subject: OfficeToolSubject & { readonly title: string };
  readonly fields: readonly OfficeToolChangedField[];
  readonly fingerprint: unknown;
}

/** The user an Office tool's change is made for, and the person who proposed it, by their Role's key. */
export interface OfficeToolApplication {
  readonly user: OfficeToolUser;
  readonly proposedBy: string;
}

/**
 * A tool The Office gives Agents, run in-process by the service (spec §5.4), such as opening a
 * Decision or writing a Handover note.
 */
export interface OfficeTool<Input extends z.ZodObject = z.ZodObject> {
  /** Unique among Office tools; what the Agent calls it by. */
  readonly name: string;
  /** What the Agent reads to decide when to call it. */
  readonly description: string;
  readonly input: Input;
  /**
   * For an Office action's tool, the group of the Authority that rules it and the subject a call
   * changes. Undefined for any other tool, which a session gets only by name and every call of
   * which runs.
   */
  readonly authority?: OfficeToolAuthority;
  run(input: z.output<Input>, call: OfficeToolCall): Promise<OfficeToolResult>;
  /**
   * For an Office action's tool that can be proposed: what a call with this input changes, as it
   * stands now. Left out, a call ruled Proposal is held as Ask me.
   */
  draft?(input: z.output<Input>): Promise<OfficeToolDraft>;
  /**
   * Carries out a call the user applied from a Proposal, as the one handler does for the user's own
   * click: in `application.user`'s name, with who proposed it kept. Present with `draft`.
   */
  applyFor?(input: z.output<Input>, application: OfficeToolApplication): Promise<OfficeToolResult>;
}
