/*
 * What a Gemini CLI session runs to reach the service (spec §5.4.7), run by Node on its own, built or
 * with its types stripped, so it imports nothing of the service but this protocol's other side,
 * `office-channel.ts`, restated here:
 *
 * - `hook <channel file>`: the `BeforeTool` command hook. It hands the CLI's input to the session's
 *   channel and prints the answer. The CLI lets a call run when a hook exits 1, times out or fails to
 *   start, so every failure this relay can see, its own deadline passing included, ends in exit 2,
 *   which refuses the call: the Office rules refuse when they can't be asked.
 * - `mcp <channel file> <server>`: a stdio MCP server the CLI starts as its child, which lists the
 *   server's tools and relays each call to the channel, never over a `localhost` HTTP endpoint.
 *
 * The channel file, owner-only in the session's folder of the Office data directory, holds the
 * channel's address and the session's token, so neither is on a command line or in an environment
 * the model's commands inherit.
 */
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** Exit 2: the CLI refuses the call, showing standard error as the reason. */
const REFUSE = 2;

/**
 * The hook's own deadline, shorter than the CLI's hook timeout (`HOOK_TIMEOUT_MS`, 60 s), since the
 * CLI lets a call run when its hook times out.
 */
const RELAY_DEADLINE_MS = 50_000;

interface ChannelFile {
  readonly address: string;
  readonly token: string;
}

type ChannelRequest =
  | { readonly kind: "hook"; readonly input: unknown }
  | { readonly kind: "list-tools"; readonly server: string }
  | {
      readonly kind: "call-tool";
      readonly server: string;
      readonly name: string;
      readonly input: unknown;
    };

const [mode, channelPath, server] = process.argv.slice(2);

if (mode === "hook") {
  await hook();
} else if (mode === "mcp" && server !== undefined) {
  await relayMcpServer(server);
} else {
  process.stderr.write(
    "Usage: gemini-office-relay hook <channel file> | mcp <channel file> <server>",
  );
  process.exitCode = REFUSE;
}

async function hook(): Promise<void> {
  const deadline = setTimeout(() => {
    process.stderr.write(
      "The Office could not judge this call in time, so it is refused. Try it again.",
    );
    process.exit(REFUSE);
  }, RELAY_DEADLINE_MS);
  try {
    const input = JSON.parse(await standardInput()) as unknown;
    const answer = await ask({ kind: "hook", input });
    // Only a decision the CLI reads as one is printed: anything else could let the call run.
    if (!isHookDecision(answer)) throw new Error("the service gave no decision");
    process.stdout.write(JSON.stringify(answer));
  } catch (error) {
    process.stderr.write(
      `The Office could not judge this call, so it is refused: ${messageOf(error)}`,
    );
    process.exitCode = REFUSE;
  } finally {
    clearTimeout(deadline);
  }
}

async function relayMcpServer(name: string): Promise<void> {
  // The tools come with their JSON Schemas from the channel, so they are served on the protocol
  // server itself.
  const mcp = new McpServer({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await ask({ kind: "list-tools", server: name })) as Tool[],
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      return (await ask({
        kind: "call-tool",
        server: name,
        name: request.params.name,
        input: request.params.arguments ?? {},
      })) as CallToolResult;
    } catch (error) {
      return {
        content: [
          { type: "text", text: `The Office could not run this call: ${messageOf(error)}` },
        ],
        isError: true,
      };
    }
  });
  await mcp.connect(new StdioServerTransport());
}

/** Sends one request to the session's channel and reads its one answer line. */
function ask(request: ChannelRequest): Promise<unknown> {
  const { address, token } = JSON.parse(readFileSync(channelPath ?? "", "utf8")) as ChannelFile;
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    let received = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...request, token })}\n`));
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const answer = JSON.parse(received) as {
          readonly answer?: unknown;
          readonly error?: string;
        };
        if (answer.error !== undefined) reject(new Error(answer.error));
        else resolve(answer.answer);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function standardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** `office-channel.ts`'s `HookAnswer`: allow, or deny with a reason. */
function isHookDecision(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return false;
  const { decision, reason } = answer as { readonly decision?: unknown; readonly reason?: unknown };
  return decision === "allow" || (decision === "deny" && typeof reason === "string");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
