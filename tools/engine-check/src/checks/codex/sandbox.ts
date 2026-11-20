import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, CheckContext, Observation } from "../../check.ts";
import type { AskForApproval } from "../../codex/protocol.ts";
import { sortedNames } from "../observations.ts";
import { commandItems, itemStatuses, turnEnding } from "./observations.ts";

const PROBE = "sandbox-probe.mjs";
const ESCALATE =
  "Run it outside the sandbox, with escalated permissions, asking for approval to do so. ";

/**
 * What one command may do, printed as one JSON line: a write in the worktree, one beside it in the
 * temp folder (left out of the sandbox by the check's overrides), one network call, and on Linux
 * whether it runs under `no_new_privs`, which the bubblewrap sandbox sets.
 */
function probeScript(beside: string): string {
  return `import { readFileSync, writeFileSync } from "node:fs";
const tryWrite = (path) => { try { writeFileSync(path, "written"); return "written"; } catch (error) { return error.code ?? "failed"; } };
const network = await fetch("https://example.com").then(() => "reached", (error) => error.cause?.code ?? error.name);
let noNewPrivs = null;
try { noNewPrivs = /NoNewPrivs:\\s*1/.test(readFileSync("/proc/self/status", "utf8")); } catch {}
console.log("PROBE " + JSON.stringify({ inside: tryWrite("inside.txt"), beside: tryWrite(${JSON.stringify(beside)}), network, noNewPrivs }));
`;
}

/**
 * The `workspace-write` sandbox kept to the worktree (spec §5.4 Defaults, the Codex engine), with
 * the temp folders and network left out by the check's overrides: the same probe command under
 * `never`, where the sandbox alone decides, and under `untrusted`, where the Office rules accept it
 * first, as is and asked to run outside the sandbox. (Under `on-request` the model would not even
 * try the write beside the worktree.)
 */
export const codexSandboxCheck: Check = {
  id: "codex.sandbox",
  title:
    "the sandbox keeps a command's writes to the worktree and cuts the network, and an approved command runs outside it",
  async run(context) {
    return {
      never: await observeProbe(context, "never", ""),
      untrustedApproved: await observeProbe(context, "untrusted", ""),
      untrustedEscalated: await observeProbe(context, "untrusted", ESCALATE),
    };
  },
};

async function observeProbe(
  { sandbox, startCodexSession }: CheckContext,
  approvalPolicy: AskForApproval,
  escalate: string,
): Promise<Observation> {
  const name = `${approvalPolicy}${escalate === "" ? "" : "-escalated"}`;
  const repository = await sandbox.createRepository(`repository-${name}`);
  await writeFile(join(repository, PROBE), probeScript(join(sandbox.root, `beside-${name}.txt`)));
  const session = await startCodexSession({ repository, approvalPolicy });
  await session.startThread();
  const started = await session.startTurn(
    `Run \`node ${PROBE}\` in the shell once. ${escalate}Do not retry it or work around a failure. Then reply with just DONE.`,
  );
  const turn = await session.nextTurnEnd();
  const items = commandItems(session, PROBE, started.id);
  const printed = items
    .flatMap((item) => (item.aggregatedOutput ?? "").split("\n"))
    .find((line) => line.startsWith("PROBE "));
  return {
    turnEnded: turnEnding(turn),
    approvals: session.approvalCalls.length,
    // What tells the Office rules a call asks to leave the sandbox, beside the command itself.
    approvalFields: sortedNames(
      new Set(
        session.approvalCalls.flatMap((call) =>
          Object.entries(call.params)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key]) => key),
        ),
      ),
    ),
    itemStatuses: itemStatuses(items),
    probe:
      printed === undefined ? null : (JSON.parse(printed.slice("PROBE ".length)) as Observation),
  };
}
