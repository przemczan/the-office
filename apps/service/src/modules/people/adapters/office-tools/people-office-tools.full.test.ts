import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import type { Duties } from "../../application/duties.js";
import { PersonRecords } from "../../application/person-records.js";
import type { RoleService } from "../../application/role-service.js";
import { CARETAKER } from "../../domain/known-roles.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import { LIST_PEOPLE, PeopleOfficeTools, READ_ROLE } from "./people-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { toolsOver } from "./people-office-tools.fixtures.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

describe("list_people", () => {
  it("says so when nobody is hired", async () => {
    const result = await toolsOver([]).listPeople().run({}, anOfficeToolCall("s-1"));

    expect(result.text).toMatch(
      /^Nobody is hired yet\.\n\nNobody holds Default person to talk to: the Caretaker stands in\.\n/,
    );
  });
});

/** Devops, who holds Default Consultant for MCP tool hard switches while no duty is set. */
const NINA = aRole({
  key: "devops",
  card: aRoleCard({
    name: "Nina",
    title: "Devops",
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: true },
  }),
});

describe("read_role", () => {
  it("reads the whole card, instructions in full, with its Skills and MCP servers", async () => {
    const instructions = "Work from the Plan.\n\nKeep the tests green.";
    const ada = aRole({
      cardVersion: 4,
      cardSavedAt: new Date("2026-11-01T10:00:00.000Z"),
      card: aRoleCard({
        instructions,
        engineSettings: {
          codex: { model: null, effort: "low" },
          "claude-code": { model: "claude-sonnet-5-5", effort: "high" },
        },
        capabilities: { sharedMemory: true, chat: false, consultant: true, runEnvironment: false },
        permissionProfile: {
          edit: true,
          run: "project-commands",
          web: false,
          mcpTools: { "github/create_issue": { kind: "allowed" } },
        },
        authority: {
          publishOutsideThePipeline: { kind: "ask-me" },
          taskRecords: {
            kind: "own-and-others",
            own: { kind: "allowed" },
            others: { kind: "never" },
          },
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
      { role: NINA, skills: [], mcpServers: [] },
    ]).readRole();

    const result = await tool.run({ role: " developer " }, anOfficeToolCall("s-1"));

    expect(tool.name).toBe(READ_ROLE);
    expect(result.isError).toBe(false);
    const [whole, authorityInWords] = result.text.split("\n\nAuthority in effect");
    expect(whole).toEqual(
      [
        "Ada · Developer (Role developer), card version 4, saved 2026-11-01T10:00:00.000Z.",
        `responsibilities: ${ada.card.responsibilities}`,
        `instructions:\n${instructions}`,
        [
          "engineSettings: Claude Code: claude-sonnet-5-5 · high; Codex: Engine's default · low",
          'capabilities: {"sharedMemory":true,"chat":false,"consultant":true,"runEnvironment":false}',
          'permissionProfile: {"edit":true,"run":"project-commands","web":false,"mcpTools":{"github/create_issue":{"kind":"allowed"}}}',
          'authority: {"publishOutsideThePipeline":{"kind":"ask-me"},"taskRecords":{"kind":"own-and-others","own":{"kind":"allowed"},"others":{"kind":"never"}}}',
          "taskLimit: 2",
          "sessionDefault: prefer-to-continue",
          "Skills: definition-of-done",
          "MCP servers: github (on): create_issue Allowed, list_issues Consult devops; linear (off)",
        ].join("\n"),
      ].join("\n\n"),
    );
    // Every row in effect, in the card's order, saying which the card sets.
    const rows = `Authority in effect${authorityInWords ?? ""}`.split("\n");
    expect(rows[0]).toBe(
      "Authority in effect (a row not in authority above stands at the preset's default):",
    );
    expect(rows).toHaveLength(34);
    expect(rows).toEqual(
      expect.arrayContaining([
        "- Work › Task records (taskRecords): Allowed on own · Never on others' (set)",
        "- Ideas (ideas): Allowed on own · Ask me on others' (preset's default)",
        "- Projects and settings › Change Project settings (changeProjectSettings): Consult devops (preset's default)",
        "- Library › Skills (skills): Proposal (preset's default)",
        "- Run installs (runInstalls): Consult devops (preset's default)",
        "- Publish outside the Pipeline (publishOutsideThePipeline): Ask me (set)",
      ]),
    );
  });

  it("gives the Caretaker's Authority as fixed", async () => {
    const sam = aRole({ key: CARETAKER, card: aRoleCard({ name: "Sam", title: "Caretaker" }) });
    const result = await toolsOver([{ role: sam, skills: [], mcpServers: [] }])
      .readRole()
      .run({ role: CARETAKER }, anOfficeToolCall("s-1"));

    expect(result.text).toContain(
      "\n- People and Roles › Change Roles (changeRoles): Proposal (fixed)\n",
    );
    expect(result.text).toContain("\n- Run installs (runInstalls): Allowed (fixed)\n");
  });

  it("gives an MCP tool never set as Ask me while nobody holds the MCP duty", async () => {
    const ada = aRole();
    const tool = toolsOver([
      { role: ada, skills: [], mcpServers: [{ name: "github", on: true, tools: ["merge"] }] },
    ]).readRole();

    const result = await tool.run({ role: "developer" }, anOfficeToolCall("s-1"));

    expect(result.text).toContain("MCP servers: github (on): merge Ask me");
  });

  it("says when the person works with each engine's defaults, with no Skills or MCP servers", async () => {
    const role = aRole({ card: aRoleCard({ engineSettings: {} }) });
    const result = await toolsOver([{ role, skills: [], mcpServers: [] }])
      .readRole()
      .run({ role: "developer" }, anOfficeToolCall("s-1"));

    expect(result.text).toContain(
      "\nengineSettings: none set, so each engine's default model and effort\n",
    );
    expect(result.text).toContain("\nSkills: none besides the skills for everyone\n");
    expect(result.text).toContain("\nMCP servers: none\n\nAuthority in effect");
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

    new PeopleOfficeTools(
      registry,
      {} as RoleService,
      {} as PersonRecords,
      {} as Duties,
    ).onModuleInit();

    expect(
      registry.named([LIST_PEOPLE, READ_ROLE], RUN_EVERY_CALL).map(({ name }) => name),
    ).toEqual([LIST_PEOPLE, READ_ROLE]);
  });
});
