import type { Check, CheckContext, Observation } from "../../check.ts";
import type { ApprovalAnswer, ApprovalCall, CodexSession } from "../../codex/codex-session.ts";
import { APPROVAL_REQUESTS, type AskForApproval } from "../../codex/protocol.ts";
import { sortedNames } from "../observations.ts";
import {
  askedAbout,
  commandItems,
  fileChangeItems,
  fileExists,
  itemStatuses,
  mentions,
  turnEnding,
  writeFileCommand,
} from "./observations.ts";

/** The policies a Codex thread can run under, but `never`, which asks nothing. */
const POLICIES: readonly AskForApproval[] = ["untrusted", "on-request"];

const FILES = {
  acceptedCommand: "accepted-command.txt",
  declinedCommand: "declined-command.txt",
  declinedPatch: "declined-patch.txt",
  acceptedPatch: "accepted-patch.txt",
} as const;

const ONE_CALL =
  "Make exactly this one tool call, do not retry it or work around it if it is declined, then reply with just DONE.";

/** One turn each, so a declined call can't stop the model before the next. */
const STEPS = [
  `Run \`${writeFileCommand(FILES.acceptedCommand)}\` in the shell.`,
  `Run \`${writeFileCommand(FILES.declinedCommand)}\` in the shell.`,
  "Run `cat README.md` in the shell.",
  `Create ${FILES.declinedPatch} containing "patched" with apply_patch.`,
  `Create ${FILES.acceptedPatch} containing "patched" with apply_patch.`,
].map((step) => `${step} ${ONE_CALL}`);

/**
 * The Office rules through the app-server's approval requests (spec §2.3, §5.4 Defaults, the Codex
 * engine): under each approval policy, which of a command that writes, a read-only command and a file
 * change come for approval, and what an accepted and a declined one leave behind.
 */
export const codexApprovalsCheck: Check = {
  id: "codex.approvals",
  title:
    "commands and file changes come for approval under the policy, and a declined one leaves no trace",
  timeoutMs: 8 * 60 * 1000,
  async run(context) {
    const byPolicy: Record<string, Observation> = {};
    for (const policy of POLICIES) {
      byPolicy[policy] = await observePolicy(context, policy);
    }
    return byPolicy;
  },
};

async function observePolicy(
  { sandbox, startCodexSession }: CheckContext,
  approvalPolicy: AskForApproval,
): Promise<Observation> {
  const repository = await sandbox.createRepository(`repository-${approvalPolicy}`);
  const session = await startCodexSession({ repository, approvalPolicy, decide });
  await session.startThread();
  const endings: string[] = [];
  for (const step of STEPS) {
    await session.startTurn(step);
    endings.push(turnEnding(await session.nextTurnEnd()));
  }
  const commandStatuses = (file: string): string[] => itemStatuses(commandItems(session, file));
  const patchStatuses = (file: string): string[] => itemStatuses(fileChangeItems(session, file));
  return {
    turnsEnded: sortedNames(new Set(endings)),
    approvalMethods: sortedNames(new Set(session.approvalCalls.map((call) => call.method))),
    asked: {
      writingCommand: askedAbout(session, FILES.acceptedCommand),
      readOnlyCommand: askedAbout(session, "README.md"),
      fileChange: askedAbout(session, FILES.acceptedPatch),
    },
    acceptedCommand: {
      itemStatuses: commandStatuses(FILES.acceptedCommand),
      fileWritten: await fileExists(repository, FILES.acceptedCommand),
    },
    declinedCommand: {
      itemStatuses: commandStatuses(FILES.declinedCommand),
      fileWritten: await fileExists(repository, FILES.declinedCommand),
      retried: commandItems(session, FILES.declinedCommand).length > 1,
    },
    declinedFileChange: {
      itemStatuses: patchStatuses(FILES.declinedPatch),
      fileWritten: await fileExists(repository, FILES.declinedPatch),
    },
    acceptedFileChange: {
      itemStatuses: patchStatuses(FILES.acceptedPatch),
      fileWritten: await fileExists(repository, FILES.acceptedPatch),
    },
    // A command's request may carry the model's reason for it; no answer carries one back.
    commandRequestsCarryReason: session.approvalCalls
      .filter((call) => call.method === APPROVAL_REQUESTS.command)
      .some((call) => typeof call.params.reason === "string"),
  };
}

/** Declines what is named to be declined, accepts the rest. */
function decide(call: ApprovalCall, session: CodexSession): ApprovalAnswer {
  return mentions(session, call, FILES.declinedCommand) ||
    mentions(session, call, FILES.declinedPatch)
    ? "decline"
    : "accept";
}
