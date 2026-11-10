import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, type RoleService } from "../../../people/index.js";
import type { HeldCallOutcome, HeldCalls } from "../../application/held-calls.js";
import { CHANGE_ROLE_TOOL } from "../../domain/session-instructions.js";
import { RoleOfficeTools } from "./role-office-tools.js";

// What role-office-tools.test.ts and role-office-tools.full.test.ts share.

export type Words = Parameters<RoleService["reword"]>[1];

export const developer = { role: { key: "developer", card: { name: "Ada", title: "Developer" } } };

/** The tool as registered, over a People that keeps the rewordings and a hold that rules as told. */
export function toolWith(outcome: HeldCallOutcome) {
  const reworded: Array<{ key: string; words: Words; proposedBy: string }> = [];
  const holds: Array<{ call: string }> = [];
  const roles = {
    read: (key: string) => {
      if (key !== "developer") throw new RoleNotFound(key);
      return Promise.resolve(developer);
    },
    reword: (key: string, words: Words, proposedBy: string) => {
      reworded.push({ key, words, proposedBy });
      return Promise.resolve(developer);
    },
  } as unknown as RoleService;
  const heldCalls = {
    hold: (request: { call: string }) => {
      holds.push(request);
      return Promise.resolve(outcome);
    },
  } as unknown as HeldCalls;
  const registry = new OfficeToolRegistry();
  new RoleOfficeTools(registry, roles, heldCalls).onModuleInit();
  const [tool] = registry.named([CHANGE_ROLE_TOOL]);
  if (!tool) throw new Error("change_role is not registered.");
  return { tool, reworded, holds };
}

export const input = {
  role: "developer",
  instructions: "Write tests first.",
  why: "Fewer regressions.",
};
