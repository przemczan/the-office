import type { Provider } from "@nestjs/common";
import { SkillCommands } from "../../skills/index.js";

type Offered = Awaited<ReturnType<SkillCommands["forRole"]>>;

/**
 * Stands in for Skills' `SkillCommands`, as a test assembling `ThreadRunner` or `ThreadContexts`
 * by hand gives no session a library skill: none unless the test sets a session's or a Role's.
 */
export class SkillCommandsStandIn implements Pick<SkillCommands, "ofSession" | "forRole"> {
  readonly ofSessions = new Map<string, Offered>();
  readonly ofRoles = new Map<string, Offered>();

  ofSession(sessionId: string): Promise<Offered> {
    return Promise.resolve(this.ofSessions.get(sessionId) ?? []);
  }

  forRole(roleKey: string): Promise<Offered> {
    return Promise.resolve(this.ofRoles.get(roleKey) ?? []);
  }
}

export function skillCommandsProvider(standIn = new SkillCommandsStandIn()): Provider {
  return { provide: SkillCommands, useValue: standIn };
}
