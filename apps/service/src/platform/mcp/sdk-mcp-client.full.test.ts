import { afterEach, describe, expect, it } from "vitest";
import { isMarkedRunning, processMark } from "../os/process-trees.fixtures.js";
import {
  fakeStdioMcpServer,
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "./fake-mcp-servers.fixtures.js";
import { McpServerFailure, type McpConnection } from "./mcp-client.js";
import { SdkMcpClient } from "./sdk-mcp-client.js";

const client = new SdkMcpClient();
const options = { timeoutMs: 15_000 };
const PROCESS_TIMEOUT = { timeout: 30_000 };

const textOf = async (connection: McpConnection, tool: string, input = {}): Promise<string> => {
  const { content } = await connection.callTool(tool, input, options);
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
};

/** The process ids a silent fake server writes to its standard error, read from the failure. */
const processIdsIn = (failure: McpServerFailure): number[] =>
  [...failure.message.matchAll(/(?:server|started) (\d+)/g)].map(([, id]) => Number(id));

describe("SdkMcpClient", () => {
  describe("a local server (stdio)", () => {
    it("runs it with its environment variables", PROCESS_TIMEOUT, async () => {
      const connection = await client.connect(
        fakeStdioMcpServer([], { FAKE_TOKEN: "abc" }),
        options,
      );
      try {
        expect(await textOf(connection, "environment-variable", { name: "FAKE_TOKEN" })).toBe(
          "abc",
        );
        // The Office's own variables never reach a server.
        expect(await textOf(connection, "environment-variable", { name: "DATABASE_URL" })).toBe("");
      } finally {
        await connection.close();
      }
    });

    it("ends what the server started on close", PROCESS_TIMEOUT, async () => {
      const mark = processMark();
      const connection = await client.connect(fakeStdioMcpServer([mark]), options);
      const started = Number(await textOf(connection, "started-process"));
      expect(await isMarkedRunning(started, mark)).toBe(true);

      await connection.close();

      expect(await isMarkedRunning(started, mark)).toBe(false);
    });

    it("fails with what the server wrote when it ends", PROCESS_TIMEOUT, async () => {
      const failure = client.connect(fakeStdioMcpServer(["--fail"]), options);

      await expect(failure).rejects.toThrow(McpServerFailure);
      await expect(failure).rejects.toThrow(/The fake server was told to fail/);
    });

    it(
      "fails with what the server's processes wrote until their output ended, after its exit too",
      PROCESS_TIMEOUT,
      async () => {
        const failure = client.connect(fakeStdioMcpServer(["--fail-after-its-end"]), options);

        await expect(failure).rejects.toThrow(/The fake server failed after its end/);
      },
    );

    it(
      "fails at its end when a process it left holds its output open",
      PROCESS_TIMEOUT,
      async () => {
        const failure = await client
          .connect(fakeStdioMcpServer(["--fail-leaving-its-output-open"]), options)
          .catch((error: unknown) => error);

        const left = /left (\d+)/.exec(String(failure))?.[1];
        if (left) process.kill(Number(left));
        expect(failure).toBeInstanceOf(McpServerFailure);
        expect(String(failure)).toMatch(/The fake server failed, leaving its output open/);
      },
    );

    it("fails on a command that isn't there", PROCESS_TIMEOUT, async () => {
      const launch = { ...fakeStdioMcpServer(), command: "no-such-mcp-server-command" };

      await expect(client.connect(launch, options)).rejects.toThrow(McpServerFailure);
    });

    it("gives up on a server that doesn't answer, ending it", PROCESS_TIMEOUT, async () => {
      const mark = processMark();
      const failure = await client
        .connect(fakeStdioMcpServer(["--silent", mark]), { timeoutMs: 2000 })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(McpServerFailure);
      const failed = failure as McpServerFailure;
      expect(failed.message).toMatch(/didn't answer within 2 seconds/);
      const processIds = processIdsIn(failed);
      expect(processIds).toHaveLength(2);
      for (const processId of processIds) {
        expect(await isMarkedRunning(processId, mark)).toBe(false);
      }
    });
  });

  describe("a remote server (Streamable HTTP)", () => {
    let server: FakeHttpMcpServer | undefined;

    afterEach(async () => {
      await server?.close();
      server = undefined;
    });

    it("gives up on a server that doesn't answer", async () => {
      server = await startFakeHttpMcpServer({ answers: false });

      await expect(
        client.connect(
          { transport: "streamable-http", url: server.url, headers: {} },
          { timeoutMs: 500 },
        ),
      ).rejects.toThrow(/didn't answer within 1 second\./);
    });

    it("fails on a URL nothing answers at", async () => {
      const closed = await startFakeHttpMcpServer();
      await closed.close();

      await expect(
        client.connect({ transport: "streamable-http", url: closed.url, headers: {} }, options),
      ).rejects.toThrow(McpServerFailure);
    });
  });
});
