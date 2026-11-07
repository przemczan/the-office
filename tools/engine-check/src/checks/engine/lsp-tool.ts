import type {
  HookJSONOutput,
  SDKControlReloadPluginsResponse,
} from "@anthropic-ai/claude-agent-sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Check, CheckContext, Observation } from "../../check.ts";
import type { RecordedSession, SessionHook } from "../../recorded-session.ts";
import { observeCall } from "../permissions/call-observations.ts";
import { toolDecision } from "../permissions/hook-decisions.ts";
import { toolCalls, toolResultText } from "../tool-calls.ts";

const STAND_IN_SERVER = fileURLToPath(new URL("./stand-in-language-server.mjs", import.meta.url));
const SAMPLE = "sample.ts";
const SAMPLE_TEXT = "export const first = 1;\n\n\n\nconst second = first;\n";
/** The stand-in's answer, as the tool words it: its line and character, 1-based. */
const DEFINITION = `${SAMPLE}:5:3`;

/** Starts a session by one route on `repository`, with `plugin` beside its session plugin. */
type StartSession = (
  repository: string,
  plugin: string | undefined,
  preToolUse?: SessionHook,
) => Promise<LspSession>;

interface LspSession {
  readonly session: RecordedSession;
  reloadPlugins(): Promise<SDKControlReloadPluginsResponse>;
}

interface Trial {
  readonly repository: string;
  readonly plugin: string;
  readonly log: string;
}

let trials = 0;

/** A repository and a plugin naming `command` as the session's language server. */
async function trial(
  { sandbox }: Pick<CheckContext, "sandbox">,
  command: string = process.execPath,
): Promise<Trial> {
  trials += 1;
  const repository = await sandbox.createRepository(`repository-${trials}`);
  await writeFile(join(repository, SAMPLE), SAMPLE_TEXT);
  const plugin = join(sandbox.root, `language-servers-${trials}`);
  const log = join(sandbox.root, `language-server-${trials}.log`);
  await mkdir(join(plugin, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(plugin, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "office-language-servers",
      lspServers: {
        "stand-in": {
          command,
          args: [STAND_IN_SERVER, log],
          extensionToLanguage: { ".ts": "typescript" },
        },
      },
    }),
  );
  return { repository, plugin, log };
}

async function serverLog(log: string): Promise<readonly { readonly method: string }[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { method: string });
}

const lspPrompt = (repository: string): string =>
  `Load the LSP tool with ToolSearch if you need to. Then, in this order, one at a time: ` +
  `Read ${join(repository, SAMPLE)}, then call the LSP tool once with operation goToDefinition, ` +
  `filePath ${join(repository, SAMPLE)}, line 5, character 16. Do not retry a refused or failed ` +
  `call. Then reply with just OK.`;

/** The tool, the plugin and when the server starts, on a session that uses it. */
async function withServer(context: CheckContext, start: StartSession): Promise<Observation> {
  const { repository, plugin, log } = await trial(context);
  let startedBeforeTheCall: boolean | undefined;
  const { session, reloadPlugins } = await start(repository, plugin, async (input) => {
    if (input.hook_event_name === "PreToolUse" && input.tool_name === "LSP") {
      startedBeforeTheCall = (await serverLog(log)).length > 0;
    }
    return toolDecision("allow");
  });
  const reload = await reloadPlugins();
  session.send(lspPrompt(repository));
  const init = await session.init();
  await session.nextResult();
  const calls = toolCalls(session.messages).filter(({ name }) => name === "LSP");
  const call = calls.at(-1);
  const methods = (await serverLog(log)).map(({ method }) => method);
  return {
    listedInInitTools: init.tools.includes("LSP"),
    reloadHeld: reload.held === true,
    pluginErrors: reload.error_count + (init.plugin_errors?.length ?? 0),
    startedBeforeTheCall: startedBeforeTheCall ?? null,
    call: observeCall(session, calls),
    inputFields: Object.keys(call?.input ?? {}).toSorted(),
    answerNamesTheDefinition:
      call !== undefined && toolResultText(session.messages, call.id).includes(DEFINITION),
    serverAsked: methods.includes("textDocument/definition"),
  };
}

/** What an Edit of a matching file does, since a Read starts no server. */
async function startedByAnEdit(context: CheckContext, start: StartSession): Promise<boolean> {
  const { repository, plugin, log } = await trial(context);
  const { session } = await start(repository, plugin);
  const file = join(repository, SAMPLE);
  session.send(
    `Read ${file}, then use the Edit tool once to replace "second" with "third" in it. ` +
      `Then reply with just OK.`,
  );
  await session.nextResult();
  return (await serverLog(log)).length > 0;
}

const refuseLsp: SessionHook = (input): Promise<HookJSONOutput> =>
  Promise.resolve(
    input.hook_event_name === "PreToolUse" && input.tool_name === "LSP"
      ? toolDecision("deny", "The Office rules refuse this file.")
      : toolDecision("allow"),
  );

/** The hook's refusal holds an LSP call as any other: the server is never asked. */
async function refusedByTheHook(context: CheckContext, start: StartSession): Promise<Observation> {
  const { repository, plugin, log } = await trial(context);
  const { session } = await start(repository, plugin, refuseLsp);
  session.send(lspPrompt(repository));
  await session.nextResult();
  const calls = toolCalls(session.messages).filter(({ name }) => name === "LSP");
  return {
    outcome: observeCall(session, calls).outcome,
    serverAsked: (await serverLog(log)).some(({ method }) => method === "textDocument/definition"),
  };
}

/** A server missing from the workstation is no plugin error; only its call fails. */
async function missingCommand(context: CheckContext, start: StartSession): Promise<Observation> {
  const { repository, plugin } = await trial(context, "office-no-such-language-server");
  const { session, reloadPlugins } = await start(repository, plugin);
  const reload = await reloadPlugins();
  session.send(lspPrompt(repository));
  const init = await session.init();
  const result = await session.nextResult();
  return {
    listedInInitTools: init.tools.includes("LSP"),
    pluginErrors: reload.error_count + (init.plugin_errors?.length ?? 0),
    turn: result.subtype,
  };
}

/** The engine drops the tool from a session with no server, whatever `tools` names. */
async function listedWithoutServers(context: CheckContext, start: StartSession): Promise<boolean> {
  const { repository } = await trial(context);
  const { session } = await start(repository, undefined);
  const init = await session.initWithoutTurn();
  return init.tools.includes("LSP");
}

async function onRoute(context: CheckContext, start: StartSession): Promise<Observation> {
  return {
    withServer: await withServer(context, start),
    startedByAnEdit: await startedByAnEdit(context, start),
    refusedByTheHook: await refusedByTheHook(context, start),
    missingCommand: await missingCommand(context, start),
    listedWithoutServers: await listedWithoutServers(context, start),
  };
}

const plugins = (plugin: string | undefined): readonly string[] =>
  plugin === undefined ? [] : [plugin];
const hooks = (preToolUse: SessionHook | undefined) => ({
  PreToolUse: preToolUse ?? (() => Promise.resolve(toolDecision("allow"))),
});

/**
 * The LSP tool on both routes (spec §5.4), on a stand-in language server: what turns it on, when a
 * server starts, and what a refusal or a missing server does.
 */
export const lspToolCheck: Check = {
  id: "engine.lsp-tool",
  title: "the LSP tool runs a plugin's language server, at first use, under the hook",
  timeoutMs: 600_000,
  async run(context) {
    return {
      agentSdk: await onRoute(context, async (repository, plugin, preToolUse) => {
        const session = await context.startSession({
          repository,
          additionalPlugins: plugins(plugin),
          hooks: hooks(preToolUse),
        });
        return {
          session,
          reloadPlugins: () => session.control.reloadPlugins({ holdOnCacheImpact: true }),
        };
      }),
      claudeCodeP: await onRoute(context, async (repository, plugin, preToolUse) => {
        const session = await context.startClaudeCodePSession({
          repository,
          additionalPlugins: plugins(plugin),
          hooks: hooks(preToolUse),
        });
        return { session, reloadPlugins: () => session.reloadPlugins() };
      }),
    };
  },
};
