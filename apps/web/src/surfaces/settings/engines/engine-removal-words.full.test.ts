import type { Role } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  movedReferenceChange,
  movedReferencePlace,
  suggestedReplacement,
} from "./engine-removal-words.ts";

function role(key: string, name: string, title: string, letGoAt: string | null): Role {
  return { key, card: { name, title }, letGoAt } as unknown as Role;
}

const ROLES = [
  role("data-analyst", "Mia", "Data Analyst", null),
  role("reviewer", "Rex", "Reviewer", "2026-11-01T10:00:00.000Z"),
];
const SHOP = { id: "p1", name: "Shop" };

describe("where a removal moves a reference", () => {
  it("names each level", () => {
    expect(movedReferencePlace({ roleKey: null, project: null }, ROLES)).toBe("The Office default");
    expect(movedReferencePlace({ roleKey: null, project: SHOP }, ROLES)).toBe(
      "The Project default of Shop",
    );
    expect(movedReferencePlace({ roleKey: "data-analyst", project: null }, ROLES)).toBe(
      "The Role override of Mia · Data Analyst",
    );
    expect(movedReferencePlace({ roleKey: "data-analyst", project: SHOP }, ROLES)).toBe(
      "The Role override of Mia · Data Analyst in Shop",
    );
  });

  it("marks a person let go, and falls back to the key for a Role not read", () => {
    expect(movedReferencePlace({ roleKey: "reviewer", project: null }, ROLES)).toBe(
      "The Role override of Rex · Reviewer (let go)",
    );
    expect(movedReferencePlace({ roleKey: "planner", project: null }, undefined)).toBe(
      "The Role override of planner",
    );
  });
});

function engineName(engineId: string): string {
  return { second: "Second account", "claude-code": "Claude Code" }[engineId] ?? engineId;
}

describe("what a removal moves a reference to", () => {
  it("gives the engine and model on both sides", () => {
    expect(
      movedReferenceChange(
        {
          from: { engineId: "second", model: "claude-haiku-5-5" },
          to: { engineId: "claude-code", model: "claude-haiku-5-5" },
        },
        engineName,
      ),
    ).toBe("Haiku 5.5 on Second account → Haiku 5.5 on Claude Code");
  });

  it("says none when the only engine goes", () => {
    expect(
      movedReferenceChange(
        { from: { engineId: "claude-code", model: "claude-sonnet-5-5" }, to: null },
        engineName,
      ),
    ).toBe("Sonnet 5.5 on Claude Code → none");
  });
});

describe("the replacement suggested", () => {
  const officeDefault = { engineId: "claude-code", model: "claude-sonnet-5-5" };

  it("is the Office default's engine", () => {
    expect(suggestedReplacement(["second", "claude-code"], "second", officeDefault)).toBe(
      "claude-code",
    );
  });

  it("is the first other engine when the Office default's is the one going", () => {
    expect(
      suggestedReplacement(["claude-code", "second", "third"], "claude-code", officeDefault),
    ).toBe("second");
  });

  it("is none for the only engine", () => {
    expect(suggestedReplacement(["claude-code"], "claude-code", officeDefault)).toBeNull();
  });
});
