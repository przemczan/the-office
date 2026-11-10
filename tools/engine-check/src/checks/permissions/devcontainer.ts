import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Check, Observation } from "../../check.ts";
import { officeToolName } from "../../office-options.ts";
import { textResult, withOfficeTools } from "../engine/office-tools.ts";
import { pathExists } from "../paths.ts";
import { callsOn, toolCalls } from "../tool-calls.ts";
import { observeCall } from "./call-observations.ts";
import { allowCallsWithin } from "./hook-decisions.ts";

const TOOL = "write_run_environment_definition";

const DEFINITION_FILE = join(".devcontainer", "devcontainer.json");

const CONTENT = '{ "dockerComposeFile": "compose.yaml", "service": "app" }';

/**
 * The engine treats `.devcontainer/` as sensitive and asks before a write there, which
 * `permissionPrompts: 'none'` turns into a refusal even past a hook `allow`; an in-process Office
 * tool writes the file from the host, out of the engine's reach, so The Office writes the run
 * environment definition through one (spec §6). Each way runs in its own session and repository.
 */
export const devcontainerCheck: Check = {
  id: "permissions.devcontainer",
  title:
    "a Write to .devcontainer/ is refused past a hook allow, and an Office tool writes it into the worktree",
  async run({ sandbox, startSession }) {
    const [directWrite, officeTool] = await Promise.all([
      (async (): Promise<Observation> => {
        const repository = await sandbox.createRepository("direct-write");
        const session = await startSession({
          repository,
          hooks: { PreToolUse: allowCallsWithin("Write", sandbox.root) },
        });
        const path = join(repository, DEFINITION_FILE);
        session.send(
          `Use the Write tool once to create ${path} with the content: ${CONTENT}\n` +
            "Do not retry a refused call and do not use any other tool. Then reply with just OK.",
        );
        await session.nextResult();
        const { outcome, permissionDeniedMessage } = observeCall(
          session,
          callsOn(toolCalls(session.messages), "Write", path),
        );
        return { outcome, permissionDeniedMessage, onDisk: await pathExists(path) };
      })(),
      (async (): Promise<Observation> => {
        const repository = await sandbox.createRepository("office-tool");
        const path = join(repository, DEFINITION_FILE);
        const session = await startSession({
          repository,
          hooks: { PreToolUse: allowCallsWithin("Write", sandbox.root) },
          ...withOfficeTools([definitionTool(path)]),
        });
        session.send(
          `Call the ${TOOL} tool once with the text: ${CONTENT}\n` +
            "Do not retry a refused call and do not use any other tool. Then reply with just OK.",
        );
        await session.nextResult();
        const name = officeToolName(TOOL);
        const { outcome } = observeCall(
          session,
          toolCalls(session.messages).filter((call) => call.name === name),
        );
        return { outcome, onDisk: await pathExists(path) };
      })(),
    ]);
    return { directWrite, officeTool };
  },
};

/** Writes devcontainer.json from the host, as The Office's tool does once its check passes. */
function definitionTool(path: string) {
  return tool(
    TOOL,
    "Writes the run environment definition's devcontainer.json into the worktree.",
    { text: z.string() },
    async ({ text }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      return textResult("Written.");
    },
  );
}
