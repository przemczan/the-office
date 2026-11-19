import { defineTool } from "@microsoft/copilot-sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check } from "../../check.ts";
import { fieldNames, toolStarts } from "../../copilot-cli/events.ts";
import { PROJECT_SERVER, projectMcpServer } from "../../copilot-cli/project-mcp-server.ts";
import { sortedNames } from "../observations.ts";
import {
  answerHolds,
  completionOf,
  everyRunHooked,
  fileExists,
  inputMentions,
  preToolUseCalls,
  refusal,
  writeRepositoryFile,
} from "./helpers.ts";

const REFUSED_FILE = "refused.txt";
const REFUSAL_REASON_MARK = "Office rules";
const REFUSAL_REASON = `The ${REFUSAL_REASON_MARK} refuse writes to refused.txt in this Project.`;

/**
 * The gate of the Initiative: a `preToolUse` hook sees the write before it runs, and a refusal keeps
 * it from running, with the reason given to the model.
 */
export const copilotHookRefusalCheck: Check = {
  id: "copilot.hook-refusal",
  title: "a preToolUse refusal stops a file write before it runs, and the model is told the reason",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const session = await startCopilotSession({ repository });
    session.decide = ({ input }) =>
      inputMentions(input, REFUSED_FILE) ? refusal(REFUSAL_REASON) : undefined;
    const events = await session.turn(
      `Create a file named ${REFUSED_FILE} in the current folder containing the word hello. If the write is refused, don't try another way: reply with the reason you were given.`,
    );
    const refused = preToolUseCalls(session.hookCalls).filter((call) =>
      inputMentions(call.input, REFUSED_FILE),
    );
    const firstRefused = refused[0];
    return {
      hookSawTheWrite: firstRefused !== undefined,
      refusedTools: sortedNames(refused.map((call) => call.toolName)),
      writeInputFields: fieldNames(firstRefused?.input),
      fileWritten: fileExists(repository, REFUSED_FILE),
      refusedCallStarted: toolStarts(events).some((start) =>
        inputMentions(start.input, REFUSED_FILE),
      ),
      reasonInToolResult: completionOf(events, firstRefused?.toolCallId).includes(REFUSAL_REASON),
      // A refused call may never complete as a tool call, so the answer shows whether the reason reached the model.
      reasonInAnswer: answerHolds(events, REFUSAL_REASON_MARK),
      permissionAskedForRefusedCall: session.permissionCalls.some((call) =>
        inputMentions(call.request, REFUSED_FILE),
      ),
      postHookForRefusedCall: session.hookCalls.some(
        (call) => call.event !== "preToolUse" && call.toolCallId === firstRefused?.toolCallId,
      ),
      retriedAnotherWay: refused.length > 1,
    };
  },
};

const CODE_WORD = "LANTERN";

/**
 * Whether the hook sees every kind of call (shell, file read, create and edit, search, MCP and the
 * Office's own tools) before it runs, with each tool's name and input fields, and the permission
 * requests the runtime makes beside it.
 */
export const copilotHookSeesEveryCallCheck: Check = {
  id: "copilot.hook-sees-every-call",
  title: "preToolUse sees shell, file, search, MCP and Office tool calls before each runs",
  timeoutMs: 8 * 60 * 1000,
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    await writeRepositoryFile(repository, "notes.md", "first line\nsecond line\n");
    const callLog = join(sandbox.root, "mcp-calls.log");
    const session = await startCopilotSession({
      repository,
      mcpServers: { [PROJECT_SERVER]: projectMcpServer(CODE_WORD, callLog) },
      officeTools: [
        defineTool("office_status", {
          description: "Answers the Task's status in The Office.",
          parameters: { type: "object", properties: {} },
          handler: () => "In progress",
        }),
      ],
    });
    const steps = [
      "Run the shell command `git status --short` and reply DONE.",
      "Read the file notes.md with your file viewing tool and reply DONE.",
      "Create a new file created.md containing the word one, then reply DONE.",
      "Edit notes.md with your file editing tool: replace `second line` with `edited line`. Reply DONE.",
      "Search the repository's files for the text `edited` with your search tool and reply DONE.",
      "Call the read_code_word tool of the project-tools server and reply DONE.",
      "Call the office_status tool and reply DONE.",
    ];
    for (const step of steps) {
      await session.turn(`${step} Use exactly one tool call.`);
    }
    const hooks = preToolUseCalls(session.hookCalls);
    const mcpLog = await readFile(callLog, "utf8").catch(() => "");
    return {
      hookedTools: sortedNames(hooks.map((call) => call.toolName)),
      ranTools: sortedNames(toolStarts(session.events).map((start) => start.toolName)),
      everyRunHooked: everyRunHooked(session.events, session.hookCalls),
      inputFields: Object.fromEntries(
        sortedNames(hooks.map((call) => call.toolName)).map((name) => [
          name,
          sortedNames(
            hooks
              .filter((call) => call.toolName === name)
              .flatMap((call) => fieldNames(call.input)),
          ),
        ]),
      ),
      permissionKinds: sortedNames(session.permissionCalls.map((call) => call.request.kind)),
      mcpServerRan: mcpLog.includes("read_code_word"),
      postHookEvents: sortedNames(
        session.hookCalls.filter((call) => call.event !== "preToolUse").map((call) => call.event),
      ),
    };
  },
};

const RESUMED_FILE = "after-resume.txt";

/** The hook is registered again on resume and still refuses before the call runs. */
export const copilotHookAfterResumeCheck: Check = {
  id: "copilot.hook-after-resume",
  title: "after a resume the preToolUse hook still sees and refuses a write before it runs",
  async run({ sandbox, startCopilotSession }) {
    const repository = await sandbox.createRepository();
    const first = await startCopilotSession({ repository });
    await first.turn("Reply with the single word OK.");
    const sessionId = first.sessionId;
    await first.close();
    const resumed = await startCopilotSession({ repository, resume: sessionId });
    resumed.decide = ({ input }) =>
      inputMentions(input, RESUMED_FILE) ? refusal(REFUSAL_REASON) : undefined;
    await resumed.turn(
      `Create a file named ${RESUMED_FILE} containing the word hello. If the write is refused, don't try another way.`,
    );
    return {
      sameSessionId: resumed.sessionId === sessionId,
      hookSawTheWrite: preToolUseCalls(resumed.hookCalls).some((call) =>
        inputMentions(call.input, RESUMED_FILE),
      ),
      fileWritten: fileExists(repository, RESUMED_FILE),
    };
  },
};
