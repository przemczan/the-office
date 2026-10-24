import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { setTimeout as delay } from "node:timers/promises";
import type { Check, CheckContext, Observation } from "../../check.ts";
import type { MessageDelivery, ProbeSession } from "../../probe-session.ts";
import { consumedMessages } from "./requests.ts";
import { allowRunningCommandThen, observeRunningCommand, prepareRunningCommand, RUN_COMMAND_PROMPT, stopBackgroundCommand, turnEnding } from "./running-command.ts";

const BARGE_IN = "A note from the user: nothing changes, finish as planned.";
/** How long a message still held after its turn ended gets to start a turn of its own. */
const SETTLE_MS = 15_000;

/** The engine's account of a sent message: queued, started, completed or cancelled; not in the SDK's typings. */
type CommandLifecycle = { type: "command_lifecycle"; command_uuid: string; state: string };

/** Where a barge-in landed: the turn whose result lists its uuid, or a turn it started itself. */
type Landing = "running turn" | "next turn" | "with the following message" | "nowhere";

/**
 * Barge-in (spec §2.4, §5.4): a message sent while the turn's command runs. Where it landed is read
 * from the engine's own accounting; a message still held once the turn ended and the session settled
 * is followed by a plain message, to see whether it goes with it.
 */
function priorityCheck(name: string, title: string, delivery: MessageDelivery): Check {
  return {
    id: `engine.priority-${name}`,
    title,
    run: (context) => observeBargeIn(context, delivery),
  };
}

export const priorityNextCheck = priorityCheck("next", "a message with priority 'next' lands between tool calls of the running turn", {
  priority: "next",
});

export const priorityLaterCheck = priorityCheck("later", "a message with priority 'later' waits for the turn to end and starts the next", {
  priority: "later",
});

/** Without an origin, and stamped as the user's own words, as a host relaying keyboard input must (SDK `SDKMessageOrigin`). */
export const priorityNowCheck: Check = {
  id: "engine.priority-now",
  title: "a message with priority 'now' interrupts the running turn, with and without a human origin",
  async run(context) {
    return {
      withoutOrigin: await observeBargeIn(context, { priority: "now" }, "without-origin"),
      humanOrigin: await observeBargeIn(context, { priority: "now", origin: { kind: "human" } }, "human-origin"),
    };
  },
};

async function observeBargeIn({ sandbox, startSession }: CheckContext, delivery: MessageDelivery, repositoryName?: string): Promise<Observation> {
  const repository = await sandbox.createRepository(repositoryName);
  await prepareRunningCommand(repository);
  let bargeIn: string | undefined;
  const session = await startSession({
    repository,
    hooks: {
      PreToolUse: allowRunningCommandThen((running) => {
        bargeIn = running.send(BARGE_IN, delivery);
      }),
    },
  });
  session.send(RUN_COMMAND_PROMPT);
  const firstTurn = await session.nextResult();
  const landing = bargeIn === undefined ? "nowhere" : await followBargeIn(session, firstTurn, bargeIn);
  const command = observeRunningCommand(session);
  await stopBackgroundCommand(session);
  return {
    sentWhileCommandRan: bargeIn !== undefined,
    firstTurnEnded: turnEnding(firstTurn),
    landedIn: landing,
    command,
  };
}

async function followBargeIn(session: ProbeSession, firstTurn: SDKResultMessage, bargeIn: string): Promise<Landing> {
  if (consumedMessages(firstTurn).includes(bargeIn)) {
    return "running turn";
  }
  const started = session.waitForMessage((message): message is SDKMessage => isLifecycle(message, bargeIn, "started"));
  if ((await Promise.race([started, delay(SETTLE_MS, undefined, { ref: false })])) !== undefined) {
    // Its turn runs to the end, so the session is idle when the check closes it.
    await session.waitForMessage((message): message is SDKResultMessage => message.type === "result" && consumedMessages(message).includes(bargeIn));
    return "next turn";
  }
  const following = session.send("Reply with just OK.");
  for (;;) {
    const result = await session.nextResult();
    if (consumedMessages(result).includes(following)) {
      return consumedMessages(result).includes(bargeIn) ? "with the following message" : "nowhere";
    }
  }
}

function isLifecycle(message: SDKMessage, uuid: string, state: string): boolean {
  const lifecycle = message as unknown as Partial<CommandLifecycle>;
  return lifecycle.type === "command_lifecycle" && lifecycle.command_uuid === uuid && lifecycle.state === state;
}
