import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import type { ProbeSession, SessionSpec } from "../../probe-session.ts";
import { transcriptFolder } from "../../transcripts.ts";
import { seenFirstByPreToolUse } from "../permissions/call-observations.ts";
import { sortedNames } from "../observations.ts";
import { isWithin, pathExists } from "../paths.ts";
import { targetPath, toolCalls } from "../tool-calls.ts";

type MemoryTrial = {
  /** `init` names an auto-memory folder, which the engine also tells the model about. */
  memoryFolderAnnounced: boolean;
  memoryFolderCreated: boolean;
  /** How the engine answered the model's writes there, each outcome once: the model writes one file or several. */
  memoryWriteOutcomes: string[];
  memoryWritesSeenFirstByPreToolUse: boolean;
};

/**
 * The engine's auto-memory keeps a folder per repository outside the worktree, shared by every
 * Task's worktree and every Role, and the model writes to it without a prompt. The Office turns it
 * off (spec §5.4); the engine's default is the control that shows the setting matters.
 */
export const autoMemoryCheck: Check = {
  id: "engine.auto-memory",
  title: "auto-memory is off under the Office's options: no memory folder announced or written",
  async run({ sandbox, startSession }) {
    const [officeOptions, engineDefault] = await Promise.all([
      sandbox
        .createRepository("office-options")
        .then((repository) => tryToRemember(startSession, { repository })),
      sandbox
        .createRepository("engine-default")
        .then((repository) =>
          tryToRemember(startSession, { repository, settings: { autoMemoryEnabled: true } }),
        ),
    ]);
    return { officeOptions, engineDefault };
  },
};

async function tryToRemember(
  startSession: (spec: SessionSpec) => Promise<ProbeSession>,
  spec: SessionSpec,
): Promise<MemoryTrial> {
  const memoryFolder = join(transcriptFolder(spec.repository), "memory");
  const session = await startSession(spec);
  session.send(
    "Save this to your auto-memory for future sessions: the build command of this project is `make all`. Then reply with just OK.",
  );
  const init = await session.init();
  await session.nextResult();
  const writes = toolCalls(session.messages).filter((call) => {
    const target = targetPath(call.input);
    return (
      target !== undefined &&
      isWithin(target, memoryFolder) &&
      call.name !== "Read" &&
      call.name !== "Glob" &&
      call.name !== "Grep"
    );
  });
  const trial: MemoryTrial = {
    memoryFolderAnnounced: memoryPaths(init) !== undefined,
    memoryFolderCreated: await pathExists(memoryFolder),
    memoryWriteOutcomes: sortedNames(writes.map((call) => call.outcome)),
    memoryWritesSeenFirstByPreToolUse: writes.every((call) => seenFirstByPreToolUse(session, call)),
  };
  // The runner removes only empty transcript folders, so the memory the control wrote goes here.
  await rm(memoryFolder, { recursive: true, force: true });
  return trial;
}

/** `memory_paths` is in `init` on 2.1.310 though the typings do not declare it. */
function memoryPaths(init: SDKSystemMessage): unknown {
  return (init as SDKSystemMessage & { memory_paths?: unknown }).memory_paths;
}
