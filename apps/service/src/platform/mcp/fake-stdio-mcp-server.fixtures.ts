// A local MCP server for tests, run by Node as it is (types stripped), so it imports packages only.
// It starts a process of its own that outlives it unless its tree is ended, with its own arguments
// after the script, so a test's process mark is on both command lines.
//   --silent  never answers, writing `server <id>` and `started <id>` to its standard error
//   --fail    writes why to its standard error, with $FAKE_TOKEN, and ends at once
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const flags = new Set(process.argv.slice(2));

if (flags.has("--fail")) {
  // A real server may well echo its token, so the reviews' hiding of secrets is tested on it.
  process.stderr.write(`The fake server was told to fail (token ${process.env.FAKE_TOKEN}).\n`);
  process.exit(1);
}

const started = spawn(
  process.execPath,
  // After "--", so Node doesn't read them as options of its own.
  ["-e", "setInterval(() => {}, 1000)", "--", ...process.argv.slice(2)],
  { stdio: "ignore" },
);
started.unref();

if (flags.has("--silent")) {
  process.stderr.write(`server ${process.pid}\nstarted ${started.pid}\n`);
  setInterval(() => {}, 1000);
} else {
  const server = new McpServer({ name: "fake-stdio", version: "1.0.0" });
  server.registerTool(
    "echo",
    { description: "Answers with the text it is given.", inputSchema: { text: z.string() } },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool(
    "environment-variable",
    {
      description: "Answers with an environment variable's value.",
      inputSchema: { name: z.string() },
    },
    ({ name }) => ({ content: [{ type: "text", text: process.env[name] ?? "" }] }),
  );
  server.registerTool(
    "started-process",
    { description: "Answers with the id of the process the server started." },
    () => ({ content: [{ type: "text", text: String(started.pid) }] }),
  );
  await server.connect(new StdioServerTransport());
}
