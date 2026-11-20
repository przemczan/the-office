import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OfficeChannel } from "./office-channel.ts";
import { OfficeServer } from "./office-server.ts";
import { OFFICE_RELAY } from "./options.ts";

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

test("the service's hook relay prints the channel's answer", async () => {
  channel.decideHooksWith(async () => ({ decision: "allow" }));
  const allowed = await runHookRelay(await channelFile(channel.address, channel.token));
  assert.equal(allowed.exitCode, 0);
  assert.deepEqual(JSON.parse(allowed.stdout), { decision: "allow" });
  channel.decideHooksWith(async () => ({ decision: "deny", reason: "Not here." }));
  const denied = await runHookRelay(await channelFile(channel.address, channel.token));
  assert.equal(denied.exitCode, 0);
  assert.deepEqual(JSON.parse(denied.stdout), { decision: "deny", reason: "Not here." });
  assert.equal(channel.hookCalls.at(-1)?.input.tool_name, "run_shell_command");
});

test("the service's hook relay refuses with exit 2 when the token is wrong or nothing listens", async () => {
  const refusedBefore = channel.refused;
  const wrongToken = await runHookRelay(await channelFile(channel.address, "wrong"));
  assert.equal(wrongToken.exitCode, 2);
  assert.equal(channel.refused, refusedBefore + 1);
  const unreachable = await runHookRelay(
    await channelFile(OfficeChannel.addressIn(folder), channel.token),
  );
  assert.equal(unreachable.exitCode, 2);
  assert.match(unreachable.stderr, /refused/);
});

test("the service's MCP relay lists a server's tools from the channel and relays a call", async () => {
  channel.addServer(
    "office",
    new OfficeServer({
      officeTools: [
        {
          name: "get_code_word",
          description: "Answers the code word.",
          inputSchema: { type: "object", properties: {} },
          run: async () => ({ text: "LANTERN" }),
        },
      ],
      skills: { review: "---\nname: review\ndescription: Reviews.\n---\n\nReview it.\n" },
      outputSchema: undefined,
    }),
  );
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [OFFICE_RELAY, "mcp", await channelFile(channel.address, channel.token), "office"],
    }),
  );
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["get_code_word", "Skill"],
    );
    const word = await client.callTool({ name: "get_code_word", arguments: {} });
    assert.deepEqual(word.content, [{ type: "text", text: "LANTERN" }]);
    const skill = await client.callTool({ name: "Skill", arguments: { skill: "review" } });
    assert.deepEqual(skill.content, [{ type: "text", text: "\nReview it.\n" }]);
    assert.deepEqual(
      channel.toolCalls.map(({ server, name }) => `${server}/${name}`),
      ["office/get_code_word", "office/Skill"],
    );
  } finally {
    await client.close();
  }
});

let channelFiles = 0;

async function channelFile(address: string, token: string): Promise<string> {
  const file = join(folder, `channel-${channelFiles++}.json`);
  await writeFile(file, JSON.stringify({ address, token }));
  return file;
}

async function runHookRelay(
  file: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [OFFICE_RELAY, "hook", file], {
    env: { PATH: process.env["PATH"] ?? "" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  child.stdin.end(JSON.stringify(HOOK_INPUT));
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { exitCode, stdout, stderr };
}
