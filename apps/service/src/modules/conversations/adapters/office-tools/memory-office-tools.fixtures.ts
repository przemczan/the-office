import { OfficeToolRegistry } from "../../../engine/index.js";
import {
  MemoryService,
  RoleRefused,
  sessionRole,
  type AuthorityValue,
} from "../../../people/index.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { REMEMBER_TOOL } from "../../domain/session-instructions.js";
import type { Thread } from "../../domain/thread.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { MemoryOfficeTools } from "./memory-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

// What memory-office-tools.test.ts and memory-office-tools.full.test.ts share.

export type Draft = Parameters<MemoryService["write"]>[0];

export const SESSION = "session-1";

/** The tool as registered, with a Memory that keeps the drafts it is given or refuses them. */
export function toolWith(thread: Thread | undefined, refusal?: string) {
  const written: Draft[] = [];
  const memory = {
    write: (draft: Draft) => {
      if (refusal) throw new RoleRefused([refusal]);
      written.push(draft);
      return Promise.resolve();
    },
  } as unknown as MemoryService;
  const threads = {
    findBySession: (sessionId: string) =>
      Promise.resolve(sessionId === SESSION ? thread : undefined),
  } as unknown as ThreadRepository;
  const registry = new OfficeToolRegistry();
  new MemoryOfficeTools(registry, memory, threads).onModuleInit();
  const [tool] = registry.named([REMEMBER_TOOL], RUN_EVERY_CALL);
  if (!tool) throw new Error("remember is not registered.");
  return { tool, written };
}

/** A Planner's session whose Change Roles is as given. */
export const card = (sharedMemory: boolean, changeRoles: AuthorityValue) =>
  sessionRole(
    "planner",
    1,
    aPlannerCard({
      capabilities: { sharedMemory, chat: true, consultant: true, runEnvironment: false },
      authority: { ...aPlannerCard().authority, changeRoles },
    }),
    { kind: "ask-me" },
  );
