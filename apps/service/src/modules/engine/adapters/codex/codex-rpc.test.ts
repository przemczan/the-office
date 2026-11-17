import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import type { CodexNotification } from "./codex-protocol.js";
import {
  CodexAppServer,
  CodexRpc,
  CodexRpcError,
  INTERNAL_ERROR,
  METHOD_NOT_FOUND,
  type CodexRpcHandlers,
} from "./codex-rpc.js";

/** The client on two pipes, with what it wrote read back line by line. */
function connected(handlers: Partial<CodexRpcHandlers> = {}) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const notifications: CodexNotification[] = [];
  const rpc = new CodexRpc(toServer, fromServer, {
    notification: (notification) => notifications.push(notification),
    serverRequest: () => Promise.resolve({}),
    ...handlers,
  });
  const written: Record<string, unknown>[] = [];
  const waiting: ((message: Record<string, unknown>) => void)[] = [];
  createInterface({ input: toServer }).on("line", (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const next = waiting.shift();
    if (next) next(message);
    else written.push(message);
  });
  const nextWritten = () =>
    new Promise<Record<string, unknown>>((resolve) => {
      const first = written.shift();
      if (first) resolve(first);
      else waiting.push(resolve);
    });
  const send = (message: unknown) => fromServer.write(`${JSON.stringify(message)}\n`);
  return { rpc, notifications, nextWritten, send, fromServer };
}

const TURN = { id: "turn-1", status: "inProgress", error: null, items: [] };

describe("CodexRpc", () => {
  it("sends a request as one line without a jsonrpc member and takes its answer by id", async () => {
    const { rpc, nextWritten, send } = connected();

    const answer = rpc.request("turn/start", {
      threadId: "thread-1",
      input: [{ type: "text", text: "Hello", text_elements: [] }],
      effort: "low",
    });
    const request = await nextWritten();
    send({ id: request["id"], result: { turn: TURN } });

    expect(request).toEqual({
      id: 1,
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "Hello", text_elements: [] }],
        effort: "low",
      },
    });
    await expect(answer).resolves.toMatchObject({ turn: { id: "turn-1", status: "inProgress" } });
  });

  it("refuses a request answered with an error, in its words", async () => {
    const { rpc, nextWritten, send } = connected();

    const answer = rpc.request("turn/steer", {
      threadId: "thread-1",
      input: [],
      expectedTurnId: "turn-0",
    });
    const request = await nextWritten();
    send({ id: request["id"], error: { code: -32600, message: "no active turn" } });

    const error = await answer.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CodexRpcError);
    expect(error).toMatchObject({ code: -32600, message: "turn/steer failed: no active turn" });
  });

  it("refuses an answer that isn't what the protocol says", async () => {
    const { rpc, nextWritten, send } = connected();

    const answer = rpc.request("turn/steer", {
      threadId: "thread-1",
      input: [],
      expectedTurnId: "turn-0",
    });
    send({ id: (await nextWritten())["id"], result: { turn: "nope" } });

    await expect(answer).rejects.toThrow(/answered turn\/steer unexpectedly/);
  });

  it("hands the session the notifications it reads, and ignores unknown or unreadable lines", async () => {
    const { rpc, notifications, nextWritten, send, fromServer } = connected();

    fromServer.write("not json\n");
    send({ method: "thread/status/changed", params: { status: { type: "idle" } } });
    send({ method: "turn/started", params: { threadId: "thread-1" } });
    send({ id: 99, result: {} });
    send({ method: "turn/started", params: { threadId: "thread-1", turn: TURN } });
    send({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "reasoning", id: "item-0", summary: [] },
      },
    });
    send({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "commandExecution",
          id: "item-1",
          command: "/bin/bash -lc 'ls'",
          cwd: "/work",
          status: "completed",
          aggregatedOutput: "README.md\n",
          exitCode: 0,
        },
      },
    });
    // Still reading: a request after them is answered.
    const answer = rpc.request("turn/interrupt", { threadId: "thread-1", turnId: "turn-1" });
    send({ id: (await nextWritten())["id"], result: {} });
    await answer;

    expect(notifications).toEqual([
      { method: "turn/started", params: expect.objectContaining({ turn: expect.anything() }) },
      {
        method: "item/started",
        params: expect.objectContaining({
          item: { type: "other", itemType: "reasoning", id: "item-0" },
        }),
      },
      {
        method: "item/completed",
        params: expect.objectContaining({
          item: expect.objectContaining({ type: "commandExecution", exitCode: 0 }),
        }),
      },
    ]);
  });

  it("answers each server request with what the session decided, by its id", async () => {
    const serverRequest = vi.fn<CodexRpcHandlers["serverRequest"]>((request) =>
      Promise.resolve({
        decision: request.method === "item/fileChange/requestApproval" ? "decline" : "accept",
      }),
    );
    const { nextWritten, send } = connected({ serverRequest });

    send({
      id: "approval-7",
      method: "item/fileChange/requestApproval",
      params: { threadId: "t", turnId: "u", itemId: "i", startedAtMs: 1, grantRoot: null },
    });

    expect(await nextWritten()).toEqual({ id: "approval-7", result: { decision: "decline" } });
    expect(serverRequest).toHaveBeenCalledWith({
      method: "item/fileChange/requestApproval",
      params: expect.objectContaining({ itemId: "i" }),
    });
  });

  it("answers an unknown server request, a malformed one and a failed answer with errors", async () => {
    const { nextWritten, send } = connected({
      serverRequest: () => Promise.reject(new Error("the rules could not be read")),
    });

    send({ id: 1, method: "item/tool/requestUserInput", params: {} });
    expect(await nextWritten()).toEqual({
      id: 1,
      error: {
        code: METHOD_NOT_FOUND,
        message: expect.stringContaining("item/tool/requestUserInput"),
      },
    });

    send({ id: 2, method: "item/commandExecution/requestApproval", params: { command: 1 } });
    expect(await nextWritten()).toMatchObject({ id: 2, error: { code: -32602 } });

    send({
      id: 3,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "t", turnId: "u", itemId: "i", command: "ls" },
    });
    expect(await nextWritten()).toEqual({
      id: 3,
      error: { code: INTERNAL_ERROR, message: "the rules could not be read" },
    });
  });

  it("refuses what waits and what comes once the output ends", async () => {
    const { rpc, nextWritten, fromServer } = connected();

    const waiting = rpc.request("account/read", {});
    await nextWritten();
    fromServer.end();

    await expect(waiting).rejects.toThrow(/output ended.*account\/read/);
    await expect(rpc.request("account/rateLimits/read", undefined)).rejects.toThrow(/output ended/);
    expect(rpc.ended).toBe(true);
  });
});

/** A stand-in app-server: answers `initialize`, exits 3 on `exit`, and ignores anything else. */
const STAND_IN = `
const lines = require("node:readline").createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ method: "turn/started", params: { threadId: "t", turn: { id: "u", status: "inProgress", error: null } } }) + "\\n");
    process.stdout.write(JSON.stringify({ id: message.id, result: { userAgent: "stand-in/0.169.0", codexHome: process.env.CODEX_HOME } }) + "\\n");
  }
  if (message.method === "exit") { process.stderr.write("asked to exit"); process.exit(3); }
});
lines.on("close", () => process.exit(0));
`;

function standIn(notifications: CodexNotification[] = []): CodexAppServer {
  return CodexAppServer.start(
    currentOperatingSystem().processTrees,
    {
      command: process.execPath,
      args: ["-e", STAND_IN],
      env: { ...process.env, CODEX_HOME: "/data/engines/codex" },
    },
    {
      notification: (notification) => notifications.push(notification),
      serverRequest: () => Promise.resolve({}),
    },
  );
}

describe("CodexAppServer", () => {
  it("talks to the process on its standard streams", async () => {
    const notifications: CodexNotification[] = [];
    const server = standIn(notifications);

    const answer = await server.rpc.request("initialize", {
      clientInfo: { name: "the-office", title: null, version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    await server.close();

    expect(answer).toMatchObject({ codexHome: "/data/engines/codex" });
    expect(notifications.map(({ method }) => method)).toEqual(["turn/started"]);
    await expect(server.exited).resolves.toMatchObject({ code: 0 });
  });

  it("tells how the process ended and refuses what waited on it", async () => {
    const server = standIn();

    const waiting = server.rpc.request("account/read", {}).catch((error: unknown) => error);
    server.rpc.notify("exit");

    await expect(server.exited).resolves.toEqual({
      code: 3,
      signal: null,
      stderr: "asked to exit",
    });
    expect(await waiting).toMatchObject({ message: expect.stringMatching(/account\/read/) });
    await expect(server.rpc.request("account/read", {})).rejects.toThrow(/Codex app-server/);
  });

  it("ends a process that won't answer when killed", async () => {
    const server = standIn();

    const waiting = server.rpc.request("account/read", {}).catch((error: unknown) => error);
    await server.kill();

    expect(await waiting).toMatchObject({ message: expect.stringMatching(/stopped/) });
    await expect(server.exited).resolves.toMatchObject({ code: null });
  });

  it("tells that a program that isn't there failed to start", async () => {
    const server = CodexAppServer.start(
      currentOperatingSystem().processTrees,
      { command: "/no/such/codex", args: ["app-server"], env: {} },
      { notification: () => undefined, serverRequest: () => Promise.resolve({}) },
    );

    await expect(server.exited).resolves.toMatchObject({ code: null, signal: null });
    await expect(server.rpc.request("account/read", {})).rejects.toThrow(/Codex app-server/);
  });
});
