import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Check, Observation } from "../../check.ts";
import type { ProbeHook, ProbeSession, SessionSpec } from "../../probe-session.ts";
import { sortedNames } from "../observations.ts";
import { isWithin } from "../paths.ts";
import { callsOn, lastOutcome, targetPath, toolCalls, type AttemptOutcome } from "../tool-calls.ts";
import { toolDecision } from "./hook-decisions.ts";

const MARKER = "fence-marker";

/** The engine's read fence, as The Office set it until task 33; its options now leave it off. */
const FENCE_ON: Partial<SessionSpec> = {
  settings: { permissions: { blockReadsOutsideWorkingDirectories: true } },
};

/**
 * Under `blockReadsOutsideWorkingDirectories` the engine also judges every shell command, and asks,
 * past the hook's `allow`, when its parser can't show the command reads only inside (task 32's run);
 * with no approval surface it refuses. Spec §6 accepts shell reads outside, so the check runs the
 * commands refused there under a hook that allows them, with the fence on and off (the Office's
 * options, spec §6). With the fence on
 * each command has a session of its own: after one such refusal the engine refuses every later call
 * that would ask, and tells the model not to try. With the fence off the file tools are tried outside
 * too, under a hook that allows them, to show what fences them then.
 */
export const readFenceOffCheck: Check = {
  id: "permissions.read-fence-off",
  title:
    "with blockReadsOutsideWorkingDirectories off, commands a hook allows run, and only the hook fences the file tools",
  async run({ sandbox, startSession }) {
    const [repository, otherRepository] = await Promise.all([
      sandbox.createRepository(),
      sandbox.createRepository("other-repository"),
    ]);
    const outside = join(sandbox.root, "outside.txt");
    await writeFile(outside, `${MARKER}\n`);
    // Instructions in a folder above the worktree, as the user's ~/.claude/CLAUDE.md is above an Office data directory in their home folder.
    await writeFile(join(sandbox.root, "CLAUDE.md"), "Instructions above the worktree.\n");
    const commands = {
      bracedVariable: 'true | cat; echo "status=${PIPESTATUS[0]}"',
      codeOnStdin: "node -v",
      gitInAnotherFolder: `git -C "${shellPath(otherRepository)}" log -1 --oneline`,
      shellReadOutside: `cat "${shellPath(outside)}"`,
    };
    const hooks = { PreToolUse: allowListed(Object.values(commands), sandbox.root) };
    const run = async (spec: Partial<SessionSpec>, steps: readonly string[]) => {
      const session = await startSession({ repository, hooks, ...spec });
      session.send(
        "Make these tool calls one at a time, in this order. Do not retry a refused call and do not use any other tool. Then reply with just OK.\n" +
          steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
      );
      await session.nextResult();
      return session;
    };
    const [fenceOn, fenceOff, withoutExcludes] = await Promise.all([
      Promise.all(
        Object.entries(commands).map(async ([name, command]) => {
          const session = await run(FENCE_ON, [`Bash: ${command}`]);
          return [name, commandOutcome(session, command)] as const;
        }),
      ),
      run({}, [
        ...Object.values(commands).map((command) => `Bash: ${command}`),
        ...fileToolSteps(outside, sandbox.root),
      ]),
      startSession({ repository, settings: { claudeMdExcludes: [] } }),
    ]);
    return {
      fenceOn: Object.fromEntries(fenceOn),
      fenceOff: {
        ...commandOutcomes(fenceOff, commands),
        fileToolsOutside: fileToolOutcomes(fenceOff, outside),
        instructionsAbove: {
          officeOptions: await instructionFileTypes(fenceOff),
          withoutExcludes: await instructionFileTypes(withoutExcludes),
        },
      },
    };
  },
};

/** The kinds of instruction file the session loaded, as its context usage names them. */
async function instructionFileTypes(session: ProbeSession): Promise<string[]> {
  const usage = await session.control.getContextUsage();
  return sortedNames(usage.memoryFiles.map((file) => file.type));
}

function fileToolSteps(file: string, folder: string): string[] {
  return [
    `Read ${file}`,
    `Grep with pattern ${MARKER} and path ${folder}`,
    `Glob with pattern *.txt and path ${folder}`,
  ];
}

/** Allows the listed commands, and the file tools within the check's sandbox; refuses the rest. */
function allowListed(commands: readonly string[], sandboxRoot: string): ProbeHook {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const toolInput = input.tool_input as Record<string, unknown>;
    const allowed =
      input.tool_name === "Bash"
        ? commands.includes(String(toolInput["command"]))
        : ["Read", "Grep", "Glob"].includes(input.tool_name) &&
          isWithin(targetPath(toolInput) ?? "", sandboxRoot);
    return allowed
      ? toolDecision("allow")
      : toolDecision("deny", "Not one of the engine check's calls.");
  };
}

function commandOutcomes(
  session: ProbeSession,
  commands: Readonly<Record<string, string>>,
): Record<string, AttemptOutcome> {
  return Object.fromEntries(
    Object.entries(commands).map(([name, command]) => [name, commandOutcome(session, command)]),
  );
}

function commandOutcome(session: ProbeSession, command: string): AttemptOutcome {
  return lastOutcome(
    toolCalls(session.messages).filter(
      (call) => call.name === "Bash" && call.input["command"] === command,
    ),
  );
}

function fileToolOutcomes(session: ProbeSession, file: string): Observation {
  const calls = toolCalls(session.messages);
  const folder = dirname(file);
  return {
    Read: lastOutcome(callsOn(calls, "Read", file)),
    Grep: lastOutcome(callsOn(calls, "Grep", folder)),
    Glob: lastOutcome(callsOn(calls, "Glob", folder)),
  };
}

/** Git Bash takes a Windows path with forward slashes. */
function shellPath(path: string): string {
  return path.replaceAll("\\", "/");
}
