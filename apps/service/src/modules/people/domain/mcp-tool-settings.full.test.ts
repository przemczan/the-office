import { describe, expect, it } from "vitest";
import { ALLOWED, ASK_ME, consult, NEVER, type HardSwitchValue } from "./hard-switches.js";
import { mcpToolDefault } from "./duties.js";
import {
  mcpToolSetting,
  mcpToolSettingsFor,
  mcpToolSettingsProblems,
  narrowedMcpToolSetting,
  noWiderThan,
} from "./mcp-tool-settings.js";
import { consultableRoleKeys } from "./presets.js";

/** The presets' Roles, and a Role hired from scratch under `ops`. */
const CONSULTABLE = consultableRoleKeys(["ops"]);

describe("an MCP tool's setting", () => {
  it("starts at the default it is given until the user sets it", () => {
    const toolDefault = mcpToolDefault("devops");

    expect(mcpToolSetting({ "github/merge": NEVER }, "github", "list_issues", toolDefault)).toEqual(
      consult("devops"),
    );
    expect(mcpToolSetting({ "github/merge": NEVER }, "github", "merge", toolDefault)).toEqual(
      NEVER,
    );
  });

  it("follows the holder of Default Consultant for MCP tool hard switches, else asks the user", () => {
    expect(mcpToolSetting({}, "github", "merge", mcpToolDefault("ops"))).toEqual(consult("ops"));
    expect(mcpToolSetting({}, "github", "merge", mcpToolDefault(undefined))).toEqual(ASK_ME);
  });

  it("is given for every tool of a session's servers, the default included", () => {
    expect(
      mcpToolSettingsFor(
        { "github/merge": ALLOWED },
        [
          { name: "github", tools: [{ name: "merge" }, { name: "list_issues" }] },
          { name: "brave-search", tools: [{ name: "search" }] },
        ],
        consult("devops"),
      ),
    ).toEqual({
      "github/merge": ALLOWED,
      "github/list_issues": consult("devops"),
      "brave-search/search": consult("devops"),
    });
  });
});

describe("mcpToolSettingsProblems", () => {
  it("takes each setting of a tool named server/tool", () => {
    expect(
      mcpToolSettingsProblems(
        "developer",
        {
          "github/merge": ALLOWED,
          "github/create_issue": consult("cto"),
          "github/list_issues": ASK_ME,
          "github/delete_repo": NEVER,
          "github/close_issue": consult("ops"),
        },
        CONSULTABLE,
        "devops",
      ),
    ).toEqual([]);
  });

  it("refuses a key that names no tool, a Role it doesn't know and the Role itself", () => {
    expect(
      mcpToolSettingsProblems(
        "developer",
        {
          merge: ALLOWED,
          "github/create_issue": consult("janitor"),
          "github/merge": consult("developer"),
        },
        CONSULTABLE,
        "devops",
      ),
    ).toEqual([
      '"merge" doesn\'t name an MCP tool as server/tool.',
      "The MCP tool github/create_issue consults a Role The Office doesn't know.",
      "The MCP tool github/merge can't consult the Role itself.",
    ]);
  });

  it("lets the holder's own card keep the default, whose consult goes to the user", () => {
    const merge = { "github/merge": consult("ops") };

    expect(mcpToolSettingsProblems("ops", merge, CONSULTABLE, "ops")).toEqual([]);
    expect(mcpToolSettingsProblems("ops", merge, CONSULTABLE, "devops")).toEqual([
      "The MCP tool github/merge can't consult the Role itself.",
    ]);
  });
});

describe("narrowing a setting", () => {
  const ORDER: readonly HardSwitchValue[] = [ALLOWED, consult("devops"), ASK_ME, NEVER];

  it("orders Allowed, Consult, Ask me, Never, from the widest", () => {
    ORDER.forEach((wider, index) => {
      for (const narrower of ORDER.slice(index)) expect(noWiderThan(narrower, wider)).toBe(true);
      for (const wide of ORDER.slice(0, index)) expect(noWiderThan(wide, wider)).toBe(false);
    });
  });

  it("can't compare consulting one Role with consulting another", () => {
    expect(noWiderThan(consult("cto"), consult("devops"))).toBe(false);
    expect(noWiderThan(consult("devops"), consult("cto"))).toBe(false);
  });

  it("takes a Stage's setting only when it narrows the card's", () => {
    expect(narrowedMcpToolSetting(ALLOWED, ASK_ME)).toEqual(ASK_ME);
    expect(narrowedMcpToolSetting(ASK_ME, ALLOWED)).toEqual(ASK_ME);
    expect(narrowedMcpToolSetting(consult("devops"), consult("cto"))).toEqual(consult("devops"));
    expect(narrowedMcpToolSetting(NEVER, undefined)).toEqual(NEVER);
  });
});
