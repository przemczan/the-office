import { Injectable } from "@nestjs/common";
import type {
  ApprovalCall,
  ApprovalHold,
  OfficeToolRuled,
  OfficeToolRuling,
} from "../../engine/index.js";

type Holder = (sessionId: string, call: ApprovalCall) => Promise<string | undefined>;

/**
 * Where the sessions' settings find how a call waiting on approval is held, and how every Office
 * tool call is ruled. `HeldCalls` and `OfficeToolRulings` fill it: they reach the runners through
 * Consultations, so the runners can't take them themselves.
 */
@Injectable()
export class ApprovalHolds {
  private holder: Holder | undefined;
  private ruler: OfficeToolRuling | undefined;

  holdWith(holder: Holder): void {
    this.holder = holder;
  }

  ruleWith(ruler: OfficeToolRuling): void {
    this.ruler = ruler;
  }

  /** The ruling of every Office tool call; a call is held until `OfficeToolRulings` has filled it. */
  get ruling(): OfficeToolRuling {
    return {
      rule: (call, tool, input): Promise<OfficeToolRuled> =>
        this.ruler
          ? this.ruler.rule(call, tool, input)
          : Promise.resolve({
              kind: "hold",
              words: "The Office can't rule this call yet; try it again shortly.",
            }),
    };
  }

  /** The session's hold; a call is refused until `HeldCalls` has filled it. */
  of(sessionId: string): ApprovalHold {
    return (call) =>
      this.holder
        ? this.holder(sessionId, call)
        : Promise.resolve("The Office can't ask for approval yet; try the call again shortly.");
  }
}
