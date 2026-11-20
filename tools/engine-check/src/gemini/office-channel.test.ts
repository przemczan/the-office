import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OfficeChannel } from "./office-channel.ts";
import { OFFICE_CHANNEL_VARIABLE, OFFICE_SESSION_TOKEN_VARIABLE } from "./options.ts";

const HOOK_RELAY = join(import.meta.dirname, "hook-relay.ts");
const OFFICE_TOOL_SERVER = join(import.meta.dirname, "office-tool-server.ts");
const HOOK_INPUT = {
  hook_event_name: "BeforeTool",
  tool_name: "run_shell_command",
  tool_input: {},
};

let folder: string;
let channel: OfficeChannel;

before(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-channel-"));
  channel = await OfficeChannel.start(folder);
});

after(async () => {
  await channel.close();
  await rm(folder, { recursive: true, force: true });
});

test("the hook relay prints the Office's answer", async () => {
  channel.decideHooksWith(async () => ({ decision: "deny", reason: "Not here." }));
  const run = await runHookRelay({
    [OFFICE_CHANNEL_VARIABLE]: channel.address,
    [OFFICE_SESSION_TOKEN_VARIABLE]: channel.token,
  });
  assert.equal(run.exitCode, 0);
  assert.deepEqual(JSON.parse(run.stdout), { decision: "deny", reason: "Not here." });
  assert.equal(channel.hookCalls.at(-1)?.input.tool_name, "run_shell_command");
});

test("the hook relay refuses with exit 2 when the token is wrong or nothing listens", async () => {
  const refusedBefore = channel.refused;
  const wrongToken = await runHookRelay({
    [OFFICE_CHANNEL_VARIABLE]: channel.address,
    [OFFICE_SESSION_TOKEN_VARIABLE]: "wrong",
  });
  assert.equal(wrongToken.exitCode, 2);
  assert.equal(channel.refused, refusedBefore + 1);
  const unreachable = await runHookRelay({
    [OFFICE_CHANNEL_VARIABLE]: join(folder, "nothing.sock"),
    [OFFICE_SESSION_TOKEN_VARIABLE]: channel.token,
  });
  assert.equal(unreachable.exitCode, 2);
  assert.match(unreachable.stderr, /refused/);
});

test("the stdio Office tool server lists the channel's tools and relays a call", async () => {
  channel.serveTools([
    {
      name: "get_code_word",
      description: "Answers the code word.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ({ text: "LANTERN" }),
    },
  ]);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [OFFICE_TOOL_SERVER],
      env: {
        [OFFICE_CHANNEL_VARIABLE]: channel.address,
        [OFFICE_SESSION_TOKEN_VARIABLE]: channel.token,
      },
    }),
  );
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["get_code_word"],
    );
    const result = await client.callTool({ name: "get_code_word", arguments: {} });
    assert.deepEqual(result.content, [{ type: "text", text: "LANTERN" }]);
    assert.equal(channel.toolCalls.at(-1)?.name, "get_code_word");
  } finally {
    await client.close();
  }
});

async function runHookRelay(
  environment: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [HOOK_RELAY], {
    env: { PATH: process.env["PATH"] ?? "", ...environment },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.end(JSON.stringify(HOOK_INPUT));
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { exitCode, stdout, stderr };
}
