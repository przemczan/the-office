import { describe, expect, it } from "vitest";
import { ALLOWED, ASK_ME, consult, NEVER } from "./hard-switches.js";
import {
  narrowedPermissionProfile,
  permissionNarrowingProblems,
  type PermissionProfile,
} from "./permission-profile.js";

const CARD: PermissionProfile = {
  edit: true,
  run: "project-commands",
  web: true,
  mcpTools: { "github/merge": ALLOWED, "github/close_issue": ASK_ME },
};

describe("a Stage's narrowing of the Role card's profile", () => {
  it("leaves the card's profile when the Stage states nothing", () => {
    expect(narrowedPermissionProfile(CARD, undefined)).toEqual(CARD);
    expect(narrowedPermissionProfile(CARD, {})).toEqual(CARD);
  });

  it("takes away editing and the web", () => {
    expect(narrowedPermissionProfile(CARD, { edit: false, web: false })).toMatchObject({
      edit: false,
      web: false,
    });
  });

  it("narrows the run permission, never widens it", () => {
    expect(narrowedPermissionProfile(CARD, { run: "read-only-git" }).run).toBe("read-only-git");
    expect(narrowedPermissionProfile(CARD, { run: "anything" }).run).toBe("project-commands");
  });

  it("narrows each MCP tool against the card's setting, an unset one at Consult Devops", () => {
    const narrowed = narrowedPermissionProfile(CARD, {
      mcpTools: {
        "github/merge": consult("reviewer"),
        "github/close_issue": ALLOWED,
        "github/list_issues": NEVER,
        "brave-search/search": ALLOWED,
      },
    });
    expect(narrowed.mcpTools).toEqual({
      "github/merge": consult("reviewer"),
      "github/close_issue": ASK_ME,
      "github/list_issues": NEVER,
      "brave-search/search": consult("devops"),
    });
  });

  it("keeps the card's Consult when the Stage consults another Role", () => {
    const narrowed = narrowedPermissionProfile(
      { ...CARD, mcpTools: { "github/merge": consult("reviewer") } },
      { mcpTools: { "github/merge": consult("devops") } },
    );
    expect(narrowed.mcpTools).toEqual({ "github/merge": consult("reviewer") });
  });
});

describe("why a Stage's narrowing can't stand", () => {
  it("has no problem when everything narrows or matches the card", () => {
    expect(
      permissionNarrowingProblems("developer", CARD, {
        edit: false,
        run: "project-commands",
        mcpTools: { "github/merge": consult("reviewer"), "github/list_issues": ASK_ME },
      }),
    ).toEqual([]);
  });

  it("names a run permission and an MCP tool set wider than the card", () => {
    expect(
      permissionNarrowingProblems("developer", CARD, {
        run: "anything",
        mcpTools: { "github/close_issue": consult("reviewer"), "github/list_issues": ALLOWED },
      }),
    ).toEqual([
      "the run permission can only be narrowed from the Role card's.",
      "the MCP tool github/close_issue can only be narrowed from the Role card's setting.",
      "the MCP tool github/list_issues can only be narrowed from the Role card's setting.",
    ]);
  });

  it("keeps the card's rules for an MCP tool's setting", () => {
    expect(
      permissionNarrowingProblems("developer", CARD, {
        mcpTools: { "github/merge": consult("developer") },
      }),
    ).toEqual(["The MCP tool github/merge can't consult the Role itself."]);
  });
});
