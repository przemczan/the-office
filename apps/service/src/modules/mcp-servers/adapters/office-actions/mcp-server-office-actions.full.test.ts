import type { INestApplication } from "@nestjs/common";
import {
  ADD_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ROLES_ACTION,
  CHANGE_MCP_SERVER_STATE_ACTION,
  REMOVE_MCP_SERVER_ACTION,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { startMcpServersApplication } from "../../mcp-servers.fixtures.js";
import {
  PROCESS_TIMEOUT,
  SECRET,
  aFakeServer,
  aName,
  aServer,
  reasonsOf,
  serverOf,
} from "../http/mcp-servers.controller.fixtures.js";
import { sender, toolOf } from "./mcp-server-office-actions.fixtures.js";

let app: INestApplication;
let send: ReturnType<typeof sender>;

beforeEach(async () => {
  const started = await startMcpServersApplication();
  app = started.app;
  send = sender(started.url);
});

afterEach(async () => {
  await app.close();
});

const CALL = anOfficeToolCall("s-1");

/** The fingerprint of the call's draft as it stands now, as a Proposal keeps it. */
async function fingerprintOf(
  action: { name: string },
  input: unknown,
): Promise<string | undefined> {
  return (await app.get(OfficeToolRegistry).draft(action.name, input))?.fingerprint;
}

describe("the refusals of the MCP server library's Office actions", () => {
  it("refuses a local server with no command and a remote one with no URL, as the form's are", async () => {
    const stdio = await send("POST", "/mcp-servers", {
      name: aName(),
      transport: "stdio",
      serverValues: [],
    });
    const remote = await toolOf(app, ADD_MCP_SERVER_ACTION).run(
      { name: aName(), transport: "streamable-http", serverValues: [] },
      CALL,
    );

    expect(await reasonsOf(stdio)).toEqual(["A local MCP server needs a command."]);
    expect(remote).toEqual({
      isError: true,
      text: "A remote MCP server needs an http or https URL.",
    });
  });

  it("refuses a name that is taken, in words", async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);

    const answer = await toolOf(app, ADD_MCP_SERVER_ACTION).run(aServer(name), CALL);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain(name);
  });

  it("refuses a call on a server the library hasn't, up front and when it runs", async () => {
    const name = aName();

    for (const [action, input] of [
      [CHANGE_MCP_SERVER_ACTION, aServer(name)],
      [CHANGE_MCP_SERVER_STATE_ACTION, { name, state: "on" }],
      [CHANGE_MCP_SERVER_ROLES_ACTION, { name, roles: [] }],
      [REMOVE_MCP_SERVER_ACTION, { name }],
    ] as const) {
      const tool = toolOf(app, action);

      expect(await tool.authority?.check?.(input, CALL)).toMatch(/hasn't|no MCP server|not found/i);
      expect(await tool.run(input, CALL)).toMatchObject({ isError: true });
    }
  });

  it(
    "refuses to turn on a server it can't connect to, with the review's problem, secret hidden",
    PROCESS_TIMEOUT,
    async () => {
      const name = aName();
      await serverOf(await send("POST", "/mcp-servers", aFakeServer(name, ["--fail"])), 201);
      const tool = toolOf(app, CHANGE_MCP_SERVER_STATE_ACTION);

      const checked = await tool.authority?.check?.({ name, state: "on" }, CALL);
      const answer = await tool.run({ name, state: "on" }, CALL);

      expect(checked).toMatch(/told to fail \(token •••\)/);
      expect(answer.isError).toBe(true);
      expect(answer.text).toMatch(/told to fail/);
      expect(answer.text).not.toContain(SECRET);
    },
  );

  it(
    "turns a server on from the web against the review's digest as it did",
    PROCESS_TIMEOUT,
    async () => {
      const name = aName();
      await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);

      const answer = await toolOf(app, CHANGE_MCP_SERVER_STATE_ACTION).run(
        { name, state: "on", reviewDigest: "a review the server no longer matches" },
        CALL,
      );

      expect(answer.isError).toBe(true);
      expect(answer.text).toMatch(/changed since the review/);
    },
  );
});

describe("the drafts of the MCP server library's Office actions", () => {
  it(
    "fingerprints turning a server on by its review, so a changed server is out of date",
    PROCESS_TIMEOUT,
    async () => {
      const name = aName();
      await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);
      const input = { name, state: "on" } as const;
      const tool = toolOf(app, CHANGE_MCP_SERVER_STATE_ACTION);

      const drafted = await tool.draft?.(input);
      const before = await fingerprintOf(CHANGE_MCP_SERVER_STATE_ACTION, input);
      const unchanged = await fingerprintOf(CHANGE_MCP_SERVER_STATE_ACTION, input);
      const { name: _name, ...edit } = aFakeServer(name);
      await serverOf(
        await send("PUT", `/mcp-servers/${name}`, {
          ...edit,
          serverValues: [
            ...edit.serverValues,
            { name: "EXTRA", secret: false, required: false, officeWideValue: "1" },
          ],
        }),
      );
      const changed = await fingerprintOf(CHANGE_MCP_SERVER_STATE_ACTION, input);

      expect(drafted?.fields).toContainEqual(
        expect.objectContaining({
          label: "Tools it lists",
          after: expect.stringContaining("echo"),
        }),
      );
      expect(unchanged).toBe(before);
      expect(changed).not.toBe(before);
    },
  );

  it("fingerprints a change by what runs and the values' names and flags, never a secret's value", async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);
    const input = aServer(name);

    const before = await fingerprintOf(CHANGE_MCP_SERVER_ACTION, input);
    await serverOf(
      await send("PUT", `/mcp-servers/${name}`, {
        ...input,
        name: undefined,
        serverValues: input.serverValues.map((value) =>
          value.secret ? { ...value, officeWideValue: "another-secret" } : value,
        ),
      }),
    );
    const secretChanged = await fingerprintOf(CHANGE_MCP_SERVER_ACTION, input);
    await serverOf(
      await send("PUT", `/mcp-servers/${name}`, { ...input, name: undefined, command: "node" }),
    );
    const connectionChanged = await fingerprintOf(CHANGE_MCP_SERVER_ACTION, input);

    expect(secretChanged).toBe(before);
    expect(connectionChanged).not.toBe(before);
  });

  it("fingerprints the Roles by the Roles it has now, and a removal by what the server runs", async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);
    const roles = { name, roles: ["developer"] };
    const removal = { name };

    const rolesBefore = await fingerprintOf(CHANGE_MCP_SERVER_ROLES_ACTION, roles);
    const removalBefore = await fingerprintOf(REMOVE_MCP_SERVER_ACTION, removal);
    await serverOf(await send("PUT", `/mcp-servers/${name}/roles`, { roles: ["reviewer"] }));
    await serverOf(
      await send("PUT", `/mcp-servers/${name}`, {
        ...aServer(name),
        name: undefined,
        command: "node",
      }),
    );

    expect(await fingerprintOf(CHANGE_MCP_SERVER_ROLES_ACTION, roles)).not.toBe(rolesBefore);
    expect(await fingerprintOf(REMOVE_MCP_SERVER_ACTION, removal)).not.toBe(removalBefore);
    expect(await toolOf(app, REMOVE_MCP_SERVER_ACTION).draft?.(removal)).toMatchObject({
      subject: { kind: "mcp-server", id: name },
    });
  });

  it("never sets a secret's value in a Proposal that gave it: applied without, the value is unset", async () => {
    const name = aName();
    const input = aServer(name);
    const registry = app.get(OfficeToolRegistry);

    const { shown, hasSecret } = await registry.redact(ADD_MCP_SERVER_ACTION.name, input);
    const applied = await registry.applyFor(ADD_MCP_SERVER_ACTION.name, shown, {
      user: { userId: "u-1", name: "Ann" },
      proposedBy: "developer",
    });

    expect(hasSecret).toBe(true);
    expect(JSON.stringify(shown)).not.toContain(SECRET);
    expect(applied.isError).toBe(false);
  });
});
