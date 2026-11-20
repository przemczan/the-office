import {
  CopilotClient,
  defineTool,
  RuntimeConnection,
  type CopilotSession,
  type CreateSessionOptions,
  type PermissionRequestResult,
  type SessionHooks,
  type Tool,
  type ToolResultObject,
} from "@microsoft/copilot-sdk";
import { Logger } from "@nestjs/common";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type {
  CopilotListedSkill,
  CopilotMessage,
  CopilotOfficeTool,
  CopilotRuntimeSession,
  CopilotSessionHandlers,
  CopilotSessionSpec,
  OpenCopilotSession,
} from "./copilot-runtime.js";

/** What the pre-tool-use hook answers; the SDK exports the handler but not its output's type. */
type PreToolUseHookOutput = Exclude<
  Awaited<ReturnType<NonNullable<SessionHooks["onPreToolUse"]>>>,
  void
>;

/** How long the runtime has to stop before it is killed. */
const STOP_TIMEOUT_MS = 5000;

const logger = new Logger("CopilotCliSession");

/**
 * The runtime process the SDK spawned, which it keeps private: its id, to end what the runtime
 * started, and its exit, which the SDK reports to no one. The pinned SDK's `cliProcess`.
 */
interface SpawnedRuntime {
  readonly pid?: number;
  once(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
}

function spawnedRuntime(client: CopilotClient): SpawnedRuntime | undefined {
  return (client as unknown as { readonly cliProcess?: SpawnedRuntime }).cliProcess;
}

/**
 * Sessions on runtimes of the pinned `@microsoft/copilot-sdk` (spec §5.4, the Copilot CLI engine):
 * each its own process over stdio with `COPILOT_HOME` the engine's folder, signed in by the token
 * given or else by the folder's own sign-in, never a signed-in user's of the machine. Everything
 * the session decides is in `CopilotCliSession`; this only speaks the SDK.
 */
export function sdkCopilotSessions(processTrees: ProcessTrees): OpenCopilotSession {
  return async (spec, handlers) => {
    const client = new CopilotClient({
      mode: "empty",
      runtime: RuntimeConnection.forSpawnedStdio({
        env: { ...spec.environment },
        baseDirectory: spec.home,
      }),
      github:
        spec.token === undefined
          ? { useLoggedInUser: true }
          : { token: spec.token, useLoggedInUser: false },
      observability: { logLevel: "warning" },
    });
    const runtime = new SdkRuntime(client, processTrees);
    try {
      await client.start();
      runtime.watchExit(handlers);
      const options = sessionOptions(spec, handlers);
      runtime.session = spec.resume
        ? await client.resumeSession(spec.sessionId, options)
        : await client.createSession({ ...options, sessionId: spec.sessionId });
    } catch (error) {
      await runtime.close();
      throw error;
    }
    return runtime;
  };
}

class SdkRuntime implements CopilotRuntimeSession {
  session: CopilotSession | undefined;
  private closing: Promise<void> | undefined;

  constructor(
    private readonly client: CopilotClient,
    private readonly processTrees: ProcessTrees,
  ) {}

  get sessionId(): string {
    return this.opened().sessionId;
  }

  watchExit(handlers: CopilotSessionHandlers): void {
    spawnedRuntime(this.client)?.once("exit", (code, signal) => {
      if (this.closing !== undefined) return;
      handlers.runtimeExited(
        `The Copilot CLI runtime ended by itself (${signal === null ? `exit code ${code}` : signal}).`,
      );
    });
  }

  async send(message: CopilotMessage): Promise<void> {
    await this.opened().send({
      prompt: message.prompt,
      attachments: [...message.attachments],
      mode: message.mode,
      clientTurnId: message.clientTurnId,
      ...(message.responseSchema === undefined
        ? {}
        : { responseSchema: { ...message.responseSchema } }),
    });
  }

  abort(): Promise<void> {
    return this.opened().abort();
  }

  async listSkills(): Promise<readonly CopilotListedSkill[]> {
    const { skills } = await this.opened().rpc.skills.list();
    return skills.map(({ name, path, enabled }) => ({ name, path, enabled }));
  }

  close(): Promise<void> {
    this.closing ??= this.closed();
    return this.closing;
  }

  /**
   * Stops the running turn, ends every process the runtime started, which run in groups and
   * sessions of their own and outlive it, then disconnects and stops it, killed when it doesn't
   * stop in time.
   */
  private async closed(): Promise<void> {
    await this.session?.abort().catch(() => undefined);
    const processId = spawnedRuntime(this.client)?.pid;
    if (processId !== undefined) {
      await this.processTrees.endDescendants(processId).catch((error: unknown) => {
        logger.warn(`Ending the Copilot CLI runtime's processes failed: ${messageOf(error)}`);
      });
    }
    await this.session?.disconnect().catch(() => undefined);
    const stopped = await Promise.race([
      this.client.stop().then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS).unref()),
    ]);
    if (!stopped) await this.client.forceStop().catch(() => undefined);
  }

  private opened(): CopilotSession {
    if (this.session === undefined) throw new Error("The Copilot CLI session isn't open.");
    return this.session;
  }
}

/**
 * The session's options, the same on a resume (spec §5.4): the Office's lean options, the hook
 * and permission handler answered by the session, its tools, skills and MCP servers.
 */
function sessionOptions(
  spec: CopilotSessionSpec,
  handlers: CopilotSessionHandlers,
): CreateSessionOptions {
  return {
    clientName: "the-office",
    ...(spec.model === undefined ? {} : { model: spec.model }),
    workingDirectory: spec.workingDirectory,
    enableConfigDiscovery: false,
    instructions: { skipCustomInstructions: true },
    systemMessage: { mode: "append", content: spec.instructions },
    agents: { includedBuiltinAgents: [] },
    skills:
      spec.skillDirectories.length === 0
        ? { enabled: false }
        : {
            enabled: true,
            directories: [...spec.skillDirectories],
            includedBuiltinSkills: [],
            disabledSkills: [...spec.disabledSkills],
          },
    tools: {
      definitions: spec.officeTools.map(sdkTool),
      availableTools: [...spec.availableTools],
    },
    mcp: { servers: { ...spec.mcpServers } },
    events: { streaming: true, onEvent: (event) => handlers.onEvent(event) },
    git: { coauthorEnabled: false },
    state: { enableCrossSessionStore: false },
    github: { telemetryEnabled: false },
    hooks: {
      handlers: {
        onPreToolUse: async (input): Promise<PreToolUseHookOutput> => {
          const decision = await handlers.preToolUse({
            toolName: input.toolName,
            toolCallId: input.toolCallId,
            toolArgs: input.toolArgs,
            agentId: input.agentId,
          });
          return decision.allowed
            ? { permissionDecision: "allow" }
            : { permissionDecision: "deny", permissionDecisionReason: decision.reason };
        },
      },
    },
    permissions: {
      onRequest: (request): PermissionRequestResult =>
        handlers.permissionRequested(request.toolCallId)
          ? { kind: "approve-once" }
          : { kind: "reject", feedback: "The Office rules didn't allow this call." },
    },
  };
}

/**
 * An Office tool as an SDK tool, answered in the service's process. A throw fails the call with
 * its words as the result the model reads: a handler's own throw reaches the model only as "Tool
 * execution failed" (the contract's live run).
 */
function sdkTool(tool: CopilotOfficeTool): Tool {
  return defineTool(tool.name, {
    description: tool.description,
    parameters: { ...tool.parameters },
    handler: async (args, invocation): Promise<ToolResultObject | string> => {
      try {
        return await tool.answer(args, invocation.toolCallId);
      } catch (error) {
        const words = messageOf(error);
        return { textResultForLlm: words, resultType: "failure", error: words };
      }
    },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
