import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { setTimeout as delay } from "node:timers/promises";
import type { Check } from "../../check.ts";
import type { ProbeSession } from "../../probe-session.ts";
import { SESSION_PLUGIN_NAME, type SkillFixture } from "../../sandbox.ts";
import { consumedMessages } from "../engine/requests.ts";
import { listedSkillNames, namesSkill, userInvocableNames } from "./skill-observations.ts";

/** A skill the model may also run; its reply names the input it got. */
const ECHO = "echo";
/** A skill only a user's command runs (`disable-model-invocation: true`). */
const MANUAL = "manual";
const ECHO_MARKER = "ECHOED";
const MANUAL_MARKER = "MANUALLY";

/** `$ARGUMENTS` in the body: the text after the command, substituted as the skill loads. */
function replyingSkill(
  name: string,
  marker: string,
  frontmatter?: SkillFixture["frontmatter"],
): SkillFixture {
  return {
    name,
    description: `The ${name} skill.`,
    body: `Reply with exactly the word ${marker} followed by the text: $ARGUMENTS`,
    ...(frontmatter === undefined ? {} : { frontmatter }),
  };
}

const SKILLS = [
  replyingSkill(ECHO, ECHO_MARKER),
  replyingSkill(MANUAL, MANUAL_MARKER, { "disable-model-invocation": "true" }),
];

/** How long a turn gets to end; a command the engine doesn't run may end no turn at all. */
const TURN_MS = 90_000;
/** How long a queued command still held after the first turn gets to start a turn of its own. */
const SETTLE_MS = 15_000;

/**
 * Skill commands (spec §2.4, §5.6): a user's `/<skill> <input>` sent as plain text into the
 * streaming input. Whether a plugin skill runs by its listed name `office:<name>` or by its bare
 * name, whether the input reaches it as `$ARGUMENTS`, whether a command queued with priority
 * `next` right behind the first message runs in the first turn, and whether a
 * `disable-model-invocation` skill stays out of the model's listing but runs as a command.
 */
export const skillCommandCheck: Check = {
  id: "skills.skill-command",
  title:
    "/<skill> <input> in streaming input: the name it runs by, $ARGUMENTS, queued behind the first message, a user-only skill",
  timeoutMs: 10 * 60 * 1000,
  async run({ sandbox, startSession }) {
    const session = await startSession({
      repository: await sandbox.createRepository(),
      skills: SKILLS,
    });
    await session.initWithoutTurn();
    const isChecked = (name: string): boolean => namesSkill(name, ECHO) || namesSkill(name, MANUAL);
    const listed = (await listedSkillNames(session)).filter(isChecked);
    const userInvocable = (await userInvocableNames(session)).filter(isChecked);

    const queued = await queuedBehindFirstMessage(session);
    const idleFullName = await runCommand(
      session,
      `/${SESSION_PLUGIN_NAME}:${ECHO} kiwi-17`,
      ECHO_MARKER,
      "kiwi-17",
    );
    const idleBareName = await runCommand(session, `/${ECHO} plum-23`, ECHO_MARKER, "plum-23");
    const userOnly = await runCommand(
      session,
      `/${SESSION_PLUGIN_NAME}:${MANUAL} pear-31`,
      MANUAL_MARKER,
      "pear-31",
    );
    return {
      listed,
      userInvocable,
      queuedBehindFirstMessage: queued,
      idleFullName,
      idleBareName,
      userOnlyCommand: userOnly,
    };
  },
};

interface Turn {
  readonly result: SDKResultMessage;
  /** The assistant's text in the turn, the model's reply. */
  readonly reply: string;
  /** Everything else the turn added, the skill's loaded text among it. */
  readonly rest: string;
}

/** The next turn after message index `from`, or undefined when none ends within `ms`. */
async function nextTurn(
  session: ProbeSession,
  from: number,
  ms: number,
): Promise<Turn | undefined> {
  // A waiter of its own, not nextResult(), so a turn that never ends leaves no cursor behind.
  const ended = session.waitForMessage(
    (message): message is SDKResultMessage => message.type === "result",
    from,
  );
  ended.catch(() => undefined);
  const result = await Promise.race([ended, delay(ms, undefined, { ref: false })]);
  if (result === undefined) {
    return undefined;
  }
  const turn = session.messages.slice(from, session.messages.indexOf(result) + 1);
  return {
    result,
    reply: turn
      .filter((message) => message.type === "assistant")
      .map(assistantText)
      .join("\n"),
    rest: JSON.stringify(turn.filter((message) => message.type !== "assistant")),
  };
}

function assistantText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  return message.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

type CommandOutcome = {
  /** A turn ended after the command, a model call or the engine's own answer. */
  turnEnded: boolean;
  /** The model replied with the skill's marker: the skill's text reached it. */
  skillRan: boolean;
  /** The reply names the input. */
  inputInReply: boolean;
  /** The skill's text reached the turn with `$ARGUMENTS` replaced by the input. */
  argumentsSubstituted: boolean;
};

function outcome(turn: Turn | undefined, marker: string, input: string): CommandOutcome {
  const reply = turn?.reply ?? "";
  return {
    turnEnded: turn !== undefined,
    skillRan: reply.includes(marker),
    inputInReply: reply.includes(marker) && reply.includes(input),
    argumentsSubstituted: turn?.rest.includes(`followed by the text: ${input}`) ?? false,
  };
}

/** A command into the idle session, read from the turn it starts. */
async function runCommand(
  session: ProbeSession,
  command: string,
  marker: string,
  input: string,
): Promise<CommandOutcome> {
  const from = session.messages.length;
  session.send(command);
  return outcome(await nextTurn(session, from, TURN_MS), marker, input);
}

/**
 * A plain message, then at once a skill command with priority `next`, before the first answer:
 * whether the first turn takes the command in, or a turn of its own runs it after.
 */
async function queuedBehindFirstMessage(session: ProbeSession): Promise<{
  firstTurnConsumedCommand: boolean;
  ranIn: "first turn" | "next turn" | "nowhere";
  command: CommandOutcome;
}> {
  const input = "fig-29";
  const from = session.messages.length;
  session.send("Reply with just OK.");
  const command = session.send(`/${SESSION_PLUGIN_NAME}:${ECHO} ${input}`, { priority: "next" });
  const first = await nextTurn(session, from, TURN_MS);
  if (first === undefined) {
    return {
      firstTurnConsumedCommand: false,
      ranIn: "nowhere",
      command: outcome(undefined, ECHO_MARKER, input),
    };
  }
  const firstTurnConsumedCommand = consumedMessages(first.result).includes(command);
  if (first.reply.includes(ECHO_MARKER)) {
    return {
      firstTurnConsumedCommand,
      ranIn: "first turn",
      command: outcome(first, ECHO_MARKER, input),
    };
  }
  const second = await nextTurn(
    session,
    session.messages.indexOf(first.result) + 1,
    SETTLE_MS + TURN_MS,
  );
  const commandOutcome = outcome(second, ECHO_MARKER, input);
  return {
    firstTurnConsumedCommand,
    ranIn: commandOutcome.skillRan ? "next turn" : "nowhere",
    command: commandOutcome,
  };
}
