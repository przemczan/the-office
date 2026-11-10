import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PersonRecords } from "../../application/person-records.js";
import type { RoleService } from "../../application/role-service.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import { LIST_PEOPLE, PeopleOfficeTools, READ_ROLE } from "./people-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { toolsOver } from "./people-office-tools.fixtures.js";

describe("list_people", () => {
  it("says so when nobody is hired", async () => {
    const result = await toolsOver([]).listPeople().run({}, anOfficeToolCall("s-1"));

    expect(result.text).toMatch(
      /^Nobody is hired yet\.\n\nNobody fills Planner, Developer, Reviewer/,
    );
  });
});

describe("read_role", () => {
  it("reads the whole card, instructions in full, with its Skills and MCP servers", async () => {
    const instructions = "Work from the Plan.\n\nKeep the tests green.";
    const ada = aRole({
      cardVersion: 4,
      cardSavedAt: new Date("2026-11-01T10:00:00.000Z"),
      card: aRoleCard({
        instructions,
        effort: "high",
        roleOverride: { engineId: "claude-code", model: "claude-sonnet-5-5" },
        capabilities: { sharedMemory: true, chat: false, consultant: true },
        permissionProfile: {
          edit: true,
          run: "project-commands",
          web: false,
          mcpTools: { "github/create_issue": { kind: "allowed" } },
        },
        hardSwitches: {
          runInstalls: { kind: "consult", role: "devops" },
          publishOutsideThePipeline: { kind: "ask-me" },
          changeRoles: { kind: "never" },
        },
        taskLimit: 2,
        sessionDefault: "prefer-to-continue",
      }),
    });
    const tool = toolsOver([
      {
        role: ada,
        skills: ["definition-of-done"],
        mcpServers: [
          { name: "github", on: true, tools: ["create_issue", "list_issues"] },
          { name: "linear", on: false, tools: [] },
        ],
      },
    ]).readRole();

    const result = await tool.run({ role: " developer " }, anOfficeToolCall("s-1"));

    expect(tool.name).toBe(READ_ROLE);
    expect(result).toEqual({
      isError: false,
      text: [
        "Ada · Developer (Role developer), card version 4, saved 2026-11-01T10:00:00.000Z.",
        `responsibilities: ${ada.card.responsibilities}`,
        `instructions:\n${instructions}`,
        [
          "effort: high",
          "Role override: claude-code, claude-sonnet-5-5",
          'capabilities: {"sharedMemory":true,"chat":false,"consultant":true}',
          'permissionProfile: {"edit":true,"run":"project-commands","web":false,"mcpTools":{"github/create_issue":{"kind":"allowed"}}}',
          'hardSwitches: {"runInstalls":{"kind":"consult","role":"devops"},"publishOutsideThePipeline":{"kind":"ask-me"},"changeRoles":{"kind":"never"}}',
          "taskLimit: 2",
          "sessionDefault: prefer-to-continue",
          "Skills: definition-of-done",
          "MCP servers: github (on): create_issue Allowed, list_issues Consult devops; linear (off)",
        ].join("\n"),
      ].join("\n\n"),
    });
  });

  it("says when the Role runs on the Office default, with no Skills or MCP servers", async () => {
    const result = await toolsOver([{ role: aRole(), skills: [], mcpServers: [] }])
      .readRole()
      .run({ role: "developer" }, anOfficeToolCall("s-1"));

    expect(result.text).toContain("\nRole override: none, so the Office default\n");
    expect(result.text).toContain("\nSkills: none besides the skills for everyone\n");
    expect(result.text).toMatch(/\nMCP servers: none$/);
  });

  it("says when the person was let go", async () => {
    const ada = aRole({ letGoAt: new Date("2026-11-02T08:00:00.000Z") });

    const result = await toolsOver([{ role: ada, skills: [], mcpServers: [] }])
      .readRole()
      .run({ role: "developer" }, anOfficeToolCall("s-1"));

    expect(result.isError).toBe(false);
    expect(result.text.split("\n\n")[1]).toBe(
      "Ada was let go on 2026-11-02T08:00:00.000Z: nobody fills the Role until the user hires them back.",
    );
  });

  it("refuses a Role The Office doesn't have, pointing to list_people", async () => {
    const result = await toolsOver([]).readRole().run({ role: "janitor" }, anOfficeToolCall("s-1"));

    expect(result).toEqual({
      text: 'The Office has no Role "janitor". list_people gives the Roles\' keys.',
      isError: true,
    });
  });
});

describe("People's Office tools", () => {
  it("are registered as the module starts", () => {
    const registry = new OfficeToolRegistry();

    new PeopleOfficeTools(registry, {} as RoleService, {} as PersonRecords).onModuleInit();

    expect(registry.named([LIST_PEOPLE, READ_ROLE]).map(({ name }) => name)).toEqual([
      LIST_PEOPLE,
      READ_ROLE,
    ]);
  });
});
