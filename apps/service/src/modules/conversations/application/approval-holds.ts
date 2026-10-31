import { Injectable } from "@nestjs/common";
import type { ApprovalCall, ApprovalHold } from "../../engine/index.js";

type Holder = (sessionId: string, call: ApprovalCall) => Promise<string | undefined>;

/**
 * Where the sessions' settings find how a call waiting on approval is held. `HeldCalls` fills it:
 * it reaches the runners through Consultations, so the runners can't take it themselves.
 */
@Injectable()
export class ApprovalHolds {
  private holder: Holder | undefined;

  holdWith(holder: Holder): void {
    this.holder = holder;
  }

  /** The session's hold; a call is refused until `HeldCalls` has filled it. */
  of(sessionId: string): ApprovalHold {
    return (call) =>
      this.holder
        ? this.holder(sessionId, call)
        : Promise.resolve("The Office can't ask for approval yet; try the call again shortly.");
  }
}
