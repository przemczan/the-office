import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { OfficeChannel, type ChannelHandlers, type HookAnswer } from "./office-channel.js";

const RELAY = fileURLToPath(new URL("./gemini-office-relay.ts", import.meta.url));

const DENY: HookAnswer = { decision: "deny", reason: "Refused by The Office: no." };

const HANDLERS: ChannelHandlers = {
  hook: (input) => Promise.resolve(input.tool_name === "read_file" ? { decision: "allow" } : DENY),
  listTools: () => Promise.resolve([]),
  callTool: () => Promise.resolve({ content: [] }),
};

/**
 * Runs the hook relay as the CLI runs it, with the hook's input on its standard input; never
 * synchronously, as the channel answers in this process.
 */
function hook(
  channelFile: string,
  toolName: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [RELAY, "hook", channelFile]);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.stdin.end(JSON.stringify({ tool_name: toolName, tool_input: {} }));
  return new Promise((resolve) =>
    child.once("close", (status) => resolve({ status, stdout, stderr })),
  );
}

describe("the Gemini CLI hook relay", () => {
  let folder: string;
  let channel: OfficeChannel | undefined;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-gemini-relay-"));
  });

  afterEach(async () => {
    await channel?.close();
    channel = undefined;
    await rm(folder, { recursive: true, force: true });
  });

  async function opened(handlers = HANDLERS): Promise<string> {
    const address = currentOperatingSystem().localSocketPath(
      `office-gemini-test-${randomBytes(6).toString("hex")}`,
    );
    channel = await OfficeChannel.open(address, handlers);
    const channelFile = join(folder, "channel.json");
    await writeFile(channelFile, JSON.stringify(channel.place));
    return channelFile;
  }

  it("prints the service's answer for the CLI", async () => {
    const channelFile = await opened();

    expect(await hook(channelFile, "read_file")).toMatchObject({
      status: 0,
      stdout: '{"decision":"allow"}',
    });
    expect(JSON.parse((await hook(channelFile, "run_shell_command")).stdout)).toEqual(DENY);
  });

  it("refuses the call with exit 2 when the service can't be reached", async () => {
    const channelFile = await opened();
    await channel?.close();
    channel = undefined;

    const run = await hook(channelFile, "read_file");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("The Office could not judge this call, so it is refused");
  });

  it("refuses the call when the token is wrong", async () => {
    const channelFile = await opened();
    await writeFile(
      channelFile,
      JSON.stringify({ address: channel?.place.address, token: "not-the-session's" }),
    );

    const run = await hook(channelFile, "read_file");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("This session's token is wrong.");
  });

  it("refuses the call when judging it fails", async () => {
    const channelFile = await opened({
      ...HANDLERS,
      hook: () => Promise.reject(new Error("The rules broke.")),
    });

    const run = await hook(channelFile, "read_file");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("The rules broke.");
  });

  it("refuses the call when the service's answer is no decision", async () => {
    const channelFile = await opened({
      ...HANDLERS,
      hook: () => Promise.resolve({ decision: "maybe" } as unknown as HookAnswer),
    });

    const run = await hook(channelFile, "read_file");

    expect(run).toMatchObject({ status: 2, stdout: "" });
    expect(run.stderr).toContain("the service gave no decision");
  });
});

describe("the Gemini CLI MCP relay", () => {
  let folder: string;
  let channel: OfficeChannel | undefined;
  let client: Client | undefined;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-gemini-relay-"));
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    await channel?.close();
    channel = undefined;
    await rm(folder, { recursive: true, force: true });
  });

  async function connected(answer: string): Promise<Client> {
    const address = currentOperatingSystem().localSocketPath(
      `office-gemini-test-${randomBytes(6).toString("hex")}`,
    );
    channel = await OfficeChannel.open(address, {
      ...HANDLERS,
      callTool: () => Promise.resolve({ content: [{ type: "text", text: answer }] }),
    });
    const channelFile = join(folder, "channel.json");
    await writeFile(channelFile, JSON.stringify(channel.place));
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [RELAY, "mcp", channelFile, "office"],
      }),
    );
    return client;
  }

  it.each([
    ["42", { value: 42 }],
    ["[1,2]", { value: [1, 2] }],
    ['"quoted"', { value: "quoted" }],
  ])(
    "gives an answer whose text is JSON but no object a structured content the CLI accepts: %s",
    async (text, structuredContent) => {
      const relayed = await (await connected(text)).callTool({ name: "note", arguments: {} });

      expect(relayed).toMatchObject({ content: [{ type: "text", text }], structuredContent });
    },
  );

  it.each(['{"word":"tangerine"}', "Noted."])(
    "relays any other answer as the service gave it: %s",
    async (text) => {
      const relayed = await (await connected(text)).callTool({ name: "note", arguments: {} });

      expect(relayed).toEqual({ content: [{ type: "text", text }] });
    },
  );
});
