import type { INestApplication } from "@nestjs/common";
import {
  ADD_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ROLES_ACTION,
  CHANGE_MCP_SERVER_STATE_ACTION,
  MCP_SERVERS_OFFICE_ACTIONS,
  REMOVE_MCP_SERVER_ACTION,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { startMcpServersApplication } from "../../mcp-servers.fixtures.js";
import {
  PROCESS_TIMEOUT,
  SECRET,
  aFakeServer,
  aName,
  aServer,
  serverOf,
} from "../http/mcp-servers.controller.fixtures.js";
import { sender, toolOf } from "./mcp-server-office-actions.fixtures.js";

let app: INestApplication;
let url: string;
let send: ReturnType<typeof sender>;

beforeEach(async () => {
  const started = await startMcpServersApplication();
  app = started.app;
  url = started.url;
  send = sender(url);
});

afterEach(async () => {
  await app.close();
});

const CALL = anOfficeToolCall("s-1");

describe("the Office actions of the MCP server library", () => {
  it("declares each action once, with a route no other action has", () => {
    const routes = MCP_SERVERS_OFFICE_ACTIONS.map(
      ({ route }) => `${route.method} ${route.path.replaceAll(/:\w+/g, ":")}`,
    );

    expect(new Set(routes).size).toBe(MCP_SERVERS_OFFICE_ACTIONS.length);
  });

  it("adds a server off, by the route and by the tool, a secret's value never answered", async () => {
    const routed = await serverOf(await send("POST", "/mcp-servers", aServer(aName())), 201);
    const name = aName();

    const answer = await toolOf(app, ADD_MCP_SERVER_ACTION).run(aServer(name), CALL);

    expect(routed.state).toBe("off");
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain(name);
    expect(answer.text).not.toContain(SECRET);
    expect(await serverOf(await fetch(`${url}/api/mcp-servers/${name}`))).toMatchObject({
      name,
      state: "off",
    });
  });

  it("changes what a server runs, by the route and by the tool", async () => {
    const byRoute = aName();
    const byTool = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(byRoute)), 201);
    await serverOf(await send("POST", "/mcp-servers", aServer(byTool)), 201);
    const { name: _name, ...edit } = { ...aServer(byRoute), command: "node" };

    const routed = await serverOf(await send("PUT", `/mcp-servers/${byRoute}`, edit));
    const answer = await toolOf(app, CHANGE_MCP_SERVER_ACTION).run(
      { ...aServer(byTool), command: "node" },
      CALL,
    );

    expect(routed).toMatchObject({ transport: "stdio", command: "node" });
    expect(answer).toMatchObject({ isError: false });
    expect(answer.text).not.toContain(SECRET);
  });

  it(
    "turns a server on against a review the Office makes itself, and off",
    PROCESS_TIMEOUT,
    async () => {
      const name = aName();
      await serverOf(await send("POST", "/mcp-servers", aFakeServer(name)), 201);

      const on = await toolOf(app, CHANGE_MCP_SERVER_STATE_ACTION).run({ name, state: "on" }, CALL);
      const off = await toolOf(app, CHANGE_MCP_SERVER_STATE_ACTION).run(
        { name, state: "off" },
        CALL,
      );

      expect(on).toMatchObject({ isError: false });
      expect(on.text).toContain("echo");
      expect(off).toEqual({ isError: false, text: `The MCP server ${name} is off.` });
    },
  );

  it("assigns a server to exactly the Roles given, by the route and by the tool", async () => {
    const name = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);

    const routed = await serverOf(
      await send("PUT", `/mcp-servers/${name}/roles`, { roles: ["developer"] }),
    );
    const answer = await toolOf(app, CHANGE_MCP_SERVER_ROLES_ACTION).run(
      { name, roles: ["reviewer"] },
      CALL,
    );

    expect(routed.roles).toEqual(["developer"]);
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("reviewer");
  });

  it("removes a server, by the route and by the tool", async () => {
    const byRoute = aName();
    const byTool = aName();
    await serverOf(await send("POST", "/mcp-servers", aServer(byRoute)), 201);
    await serverOf(await send("POST", "/mcp-servers", aServer(byTool)), 201);

    const routed = await send("DELETE", `/mcp-servers/${byRoute}`);
    const answer = await toolOf(app, REMOVE_MCP_SERVER_ACTION).run({ name: byTool }, CALL);

    expect(routed.status).toBe(204);
    expect(answer).toEqual({ isError: false, text: `The MCP server ${byTool} is removed.` });
  });

  describe("a call that gives a secret's value", () => {
    it("is ruled by Secret values too and shows by name only", async () => {
      const name = aName();
      await serverOf(await send("POST", "/mcp-servers", aServer(name)), 201);

      for (const action of [ADD_MCP_SERVER_ACTION, CHANGE_MCP_SERVER_ACTION]) {
        const tool = toolOf(app, action);
        const input = aServer(name);

        const groups = await tool.authority?.groupsOf?.(input);
        const redacted = await tool.redact?.(input);
        const drafted = await tool.draft?.(input).catch(() => undefined);

        expect(groups).toEqual(["secretValues"]);
        expect(redacted?.hasSecret).toBe(true);
        expect(JSON.stringify(redacted)).not.toContain(SECRET);
        expect(JSON.stringify(drafted)).not.toContain(SECRET);
        expect(redacted?.shown.serverValues).toContainEqual({
          name: "GITHUB_TOKEN",
          secret: true,
          required: true,
        });
      }
    });

    it("leaves a call of plain values to MCP servers alone", async () => {
      const tool = toolOf(app, ADD_MCP_SERVER_ACTION);
      const input = {
        ...aServer(aName()),
        serverValues: [
          { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "github.com" },
          { name: "GITHUB_TOKEN", secret: true, required: true },
        ],
      };

      expect(await tool.authority?.groupsOf?.(input)).toEqual([]);
      expect((await tool.redact?.(input))?.hasSecret).toBe(false);
    });

    it("names the secret in the draft by its field, with no value", async () => {
      const tool = toolOf(app, ADD_MCP_SERVER_ACTION);

      const drafted = await tool.draft?.(aServer(aName()));

      expect(drafted?.fields).toContainEqual({
        label: "GITHUB_TOKEN (Secret value)",
        before: null,
        after: null,
        form: "secret",
      });
    });
  });
});
