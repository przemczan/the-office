import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../json.ts";
import { GEMINI_CHECK_MODEL, GEMINI_CORE_TOOLS, mcpToolName } from "./options.ts";

/**
 * The folder `--gemini-sign-in` signs a Google account into, the check's own `GEMINI_CLI_HOME`
 * (git-ignored with the rest of `out/`). A session never runs in it: each gets a home of its own in
 * the check's sandbox with the sign-in's credential files copied in.
 */
export const SIGNED_IN_HOME = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "out",
  "gemini-home",
);

/** The CLI keeps everything of a home under `<home>/.gemini/`. */
export function geminiFolder(home: string): string {
  return join(home, ".gemini");
}

/** The files a Google sign-in leaves in the folder: the OAuth tokens and which account is active. */
export const CREDENTIAL_FILES = ["oauth_creds.json", "google_accounts.json"] as const;

/** What `--gemini-sign-in` noted about its own run, which `gemini.sign-in` reads. */
export interface SignInRecord {
  /** Whether the CLI's stdin was a terminal; the sign-in always pipes it, so false. */
  readonly stdinWasTerminal: boolean;
  readonly signedIn: boolean;
  /** Sorted names of the files the sign-in left in `<home>/.gemini/`. */
  readonly filesLeft: readonly string[];
}

export const SIGN_IN_RECORD = join(SIGNED_IN_HOME, "sign-in.json");

export async function readSignInRecord(): Promise<SignInRecord | undefined> {
  try {
    return JSON.parse(await readFile(SIGN_IN_RECORD, "utf8")) as SignInRecord;
  } catch {
    return undefined;
  }
}

export interface StdioServerSetting {
  readonly command: string;
  readonly args: readonly string[];
  /** Values may name the CLI's own variables as `$NAME`, which the CLI expands, so no value is written here. */
  readonly env?: Readonly<Record<string, string>>;
  readonly trust?: boolean;
}

export interface GeminiSettingsOptions {
  /** How the CLI signs in: a Gemini API key from its environment, or Login with Google. */
  readonly authType: "gemini-api-key" | "oauth-personal";
  /** The `BeforeTool` command hook, run through the CLI's shell for every tool. */
  readonly hookCommand: string;
  /** How long the CLI waits for the hook; its default (60 s) when omitted. */
  readonly hookTimeoutMs?: number;
  /**
   * Every MCP server the session has, by name, whatever starts it: `tools.core` names their tools as
   * `mcp_<server>_*`, since headless the CLI hides any tool the list leaves out, MCP tools included.
   */
  readonly mcpServerNames?: readonly string[];
  /** MCP servers the CLI starts from its settings; an ACP session names its own in `session/new` instead. */
  readonly mcpServers?: Readonly<Record<string, StdioServerSetting>>;
}

/**
 * The user settings a session's home gets: its sign-in; no telemetry, usage statistics,
 * auto update, checkpointing, sandbox or IDE; folder trust off so the hook and the workspace's skills
 * load; chats kept (no retention sweep); the core tools and the MCP servers' tools named; the Office
 * hook on every tool call.
 */
export function geminiSettings(options: GeminiSettingsOptions): Json {
  return {
    security: {
      auth: { selectedType: options.authType },
      folderTrust: { enabled: false },
      disableAlwaysAllow: true,
    },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: {
      enableAutoUpdate: false,
      enableAutoUpdateNotification: false,
      checkpointing: { enabled: false },
      sessionRetention: { enabled: false },
    },
    experimental: { autoMemory: false },
    ide: { enabled: false },
    model: { name: GEMINI_CHECK_MODEL },
    tools: {
      core: [
        ...GEMINI_CORE_TOOLS,
        ...(options.mcpServerNames ?? []).map((name) => mcpToolName(name, "*")),
      ],
    },
    skills: { enabled: true },
    hooksConfig: { enabled: true },
    hooks: {
      BeforeTool: [
        {
          matcher: ".*",
          hooks: [
            {
              name: "office",
              type: "command",
              command: options.hookCommand,
              ...(options.hookTimeoutMs === undefined ? {} : { timeout: options.hookTimeoutMs }),
            },
          ],
        },
      ],
    },
    mcpServers: Object.fromEntries(
      Object.entries(options.mcpServers ?? {}).map(([name, server]) => [
        name,
        {
          command: server.command,
          args: [...server.args],
          ...(server.env === undefined ? {} : { env: { ...server.env } }),
          ...(server.trust === undefined ? {} : { trust: server.trust }),
        },
      ]),
    ),
  };
}

/**
 * A user policy that asks before every tool call, built-in or MCP, whatever the approval mode. Over
 * ACP the ask reaches the client as `session/request_permission`, which is where the Office rules
 * answer; headless the CLI turns an ask into a refusal, so a headless session goes without it.
 */
export const ASK_EVERY_CALL_POLICY = `# The Office answers every tool call through session/request_permission.
[[rule]]
toolName = "*"
decision = "ask_user"
priority = 999

[[rule]]
toolName = "*"
mcpName = "*"
decision = "ask_user"
priority = 999
`;

export interface HomeContents {
  readonly settings: Json;
  /** User policy files by name, written to `<home>/.gemini/policies/`. */
  readonly policies?: Readonly<Record<string, string>>;
  /** Copies the credential files from this signed-in home; an unsigned home when omitted. */
  readonly credentialsFrom?: string;
}

/** Writes a session's home: its settings, its policies and, when given, the sign-in's credentials. */
export async function writeHome(home: string, contents: HomeContents): Promise<void> {
  const folder = geminiFolder(home);
  await mkdir(join(folder, "policies"), { recursive: true });
  await writeFile(join(folder, "settings.json"), `${JSON.stringify(contents.settings, null, 2)}\n`);
  for (const [name, text] of Object.entries(contents.policies ?? {})) {
    await writeFile(join(folder, "policies", name), text);
  }
  if (contents.credentialsFrom !== undefined) {
    for (const file of CREDENTIAL_FILES) {
      await copyFile(join(geminiFolder(contents.credentialsFrom), file), join(folder, file));
    }
  }
}

/** Whether the home holds a Google sign-in's credential files. */
export async function isSignedIn(home: string): Promise<boolean> {
  try {
    await readFile(join(geminiFolder(home), CREDENTIAL_FILES[0]));
    return true;
  } catch {
    return false;
  }
}

/**
 * A command line the CLI's hook runner can run: it runs a hook through PowerShell on Windows, where
 * a quoted path is a string unless called with `&`, and through `bash -c` elsewhere.
 */
export function nodeScriptCommand(
  script: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const line = `"${process.execPath}" "${script}"`;
  return platform === "win32" ? `& ${line}` : line;
}
