import { describe, expect, it } from "vitest";
import { z } from "zod";
import { splitByArea } from "./office-tool-split.js";
import type { OfficeTool, OfficeToolCall } from "../ports/office-tool.js";
import type { OfficeToolRuling } from "../ports/office-tool-ruling.js";
import { RUN_EVERY_CALL } from "../ports/office-tool-ruling.fixtures.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { CALL_OFFICE_TOOL, LIST_OFFICE_TOOLS, officeToolPair } from "./office-tool-pair.js";

const CALL = { sessionId: "s-1", outputFolder: "out" } as OfficeToolCall;

function tool(name: string, area: OfficeTool["area"], ran: unknown[] = []): OfficeTool {
  return {
    name,
    area,
    description: `The ${name} tool.`,
    input: z.object({ title: z.string() }),
    run: (input) => {
      ran.push(input);
      return Promise.resolve({ text: `${name} done.`, isError: false });
    },
  };
}

function registryOf(...tools: OfficeTool[]): OfficeToolRegistry {
  const registry = new OfficeToolRegistry();
  for (const each of tools) registry.register(each);
  return registry;
}

function pairOver(
  ruling: OfficeToolRuling,
  ran: unknown[] = [],
): { list: OfficeTool; call: OfficeTool } {
  const registry = registryOf(
    tool("remember", "core"),
    tool("create_task", "work", ran),
    tool("create_initiative", "initiatives", ran),
  );
  const { reachable } = splitByArea(
    registry.named(["remember", "create_task", "create_initiative"], ruling),
    [],
  );
  const [list, call] = officeToolPair(reachable) as [OfficeTool, OfficeTool];
  return { list, call };
}

const names = (list: readonly OfficeTool[]) => list.map(({ name }) => name);

describe("splitByArea", () => {
  const tools = [
    tool("remember", "core"),
    tool("create_task", "work"),
    tool("create_initiative", "initiatives"),
  ];

  it("loads Core and the home's areas, and leaves the rest to be reached", () => {
    expect(names(splitByArea(tools, []).loaded)).toEqual(["remember"]);
    expect(names(splitByArea(tools, []).reachable)).toEqual(["create_task", "create_initiative"]);
    expect(names(splitByArea(tools, ["work"]).loaded)).toEqual(["remember", "create_task"]);
    expect(names(splitByArea(tools, ["work", "initiatives"]).reachable)).toEqual([]);
  });

  it("loads every tool for a Stage's Thread", () => {
    expect(splitByArea(tools, "all").reachable).toEqual([]);
  });
});

describe("officeToolPair", () => {
  it("lists each reachable tool's name, description and input schema, by area on request", async () => {
    const { list } = pairOver(RUN_EVERY_CALL);

    const all = JSON.parse((await list.run({}, CALL)).text) as { name: string }[];
    expect(all.map(({ name }) => name)).toEqual(["create_task", "create_initiative"]);
    const work = JSON.parse((await list.run({ area: "work" }, CALL)).text) as {
      name: string;
      description: string;
      inputSchema: { properties: Record<string, unknown> };
    }[];
    expect(work).toMatchObject([{ name: "create_task", description: "The create_task tool." }]);
    expect(work[0]?.inputSchema.properties).toHaveProperty("title");
  });

  it("calls the wrapped tool with its validated input", async () => {
    const ran: unknown[] = [];
    const { call } = pairOver(RUN_EVERY_CALL, ran);

    expect(await call.run({ name: "create_task", input: { title: "A" } }, CALL)).toEqual({
      text: "create_task done.",
      isError: false,
    });
    expect(ran).toEqual([{ title: "A" }]);
  });

  it("refuses input the wrapped tool's schema rejects, without running it", async () => {
    const ran: unknown[] = [];
    const { call } = pairOver(RUN_EVERY_CALL, ran);

    const result = await call.run({ name: "create_task", input: { title: 3 } }, CALL);

    expect(result.isError).toBe(true);
    expect(result.text).toContain("The input of create_task is not valid");
    expect(ran).toEqual([]);
  });

  it("refuses a name that isn't reachable, a loaded tool and one ruled Never alike, as unknown", async () => {
    const ran: unknown[] = [];
    const never: OfficeToolRuling = {
      rule: (_call, { name }) =>
        Promise.resolve(name === "create_task" ? { kind: "never" } : { kind: "run" }),
    };
    const { call } = pairOver(never, ran);

    for (const name of ["remember", "no_such_tool"]) {
      expect(await call.run({ name, input: {} }, CALL)).toEqual({
        text: `No Office tool is registered as ${name}.`,
        isError: true,
      });
    }
    // Ruled Never at the call, it answers as an unknown tool and never runs.
    expect(await call.run({ name: "create_task", input: { title: "A" } }, CALL)).toEqual({
      text: "No Office tool is registered as create_task.",
      isError: true,
    });
    expect(ran).toEqual([]);
  });

  it("rules the inner call once, naming the real action and its input", async () => {
    const ruled: { name: string; input: unknown }[] = [];
    const holding: OfficeToolRuling = {
      rule: (_call, { name }, input) => {
        ruled.push({ name, input });
        return Promise.resolve({ kind: "hold", words: "Waiting for the user's approval." });
      },
    };
    const ran: unknown[] = [];
    const { call } = pairOver(holding, ran);

    const result = await call.run({ name: "create_task", input: { title: "A" } }, CALL);

    expect(result).toEqual({ text: "Waiting for the user's approval.", isError: true });
    expect(ruled).toEqual([{ name: "create_task", input: { title: "A" } }]);
    expect(ran).toEqual([]);
  });

  it("is named list_office_tools and call_office_tool, in Core", () => {
    const { list, call } = pairOver(RUN_EVERY_CALL);
    expect([list.name, call.name, list.area, call.area]).toEqual([
      LIST_OFFICE_TOOLS,
      CALL_OFFICE_TOOL,
      "core",
      "core",
    ]);
  });
});
