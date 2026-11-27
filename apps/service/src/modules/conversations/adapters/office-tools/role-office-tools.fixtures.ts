import { OfficeToolRegistry } from "../../../engine/index.js";
import { RoleNotFound, RoleRefused, type RoleService } from "../../../people/index.js";
import type { HeldCallOutcome, HeldCalls } from "../../application/held-calls.js";
import { CHANGE_ROLE_TOOL } from "../../domain/session-instructions.js";
import { RoleOfficeTools } from "./role-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

// What role-office-tools.test.ts and role-office-tools.full.test.ts share.

export type Words = { responsibilities?: string; instructions?: string };

export const developer = {
  role: {
    key: "developer",
    card: { name: "Ada", title: "Developer", responsibilities: "Builds.", instructions: "Old." },
  },
  skills: ["testing"],
};

/** The tool as registered, over a People that keeps the card changes and a hold that rules as told. */
export function toolWith(outcome: HeldCallOutcome, refusal?: readonly string[]) {
  const reworded: Array<{
    key: string;
    card: Record<string, unknown>;
    skills: readonly string[];
    savedBy: unknown;
    proposedBy: string;
  }> = [];
  const holds: Array<{ call: string }> = [];
  const roles = {
    read: (key: string) => {
      if (key !== "developer") throw new RoleNotFound(key);
      return Promise.resolve(developer);
    },
    changeCard: (
      key: string,
      card: Record<string, unknown>,
      skills: readonly string[],
      savedBy: unknown,
      proposedBy: string,
    ) => {
      if (refusal) return Promise.reject(new RoleRefused(refusal));
      reworded.push({ key, card, skills, savedBy, proposedBy });
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
  const [tool] = registry.named([CHANGE_ROLE_TOOL], RUN_EVERY_CALL);
  if (!tool) throw new Error("change_role is not registered.");
  return { tool, reworded, holds };
}

export const input = {
  role: "developer",
  instructions: "Write tests first.",
  why: "Fewer regressions.",
};
