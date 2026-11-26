import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RUN_EVERY_CALL } from "../../engine/index.fixtures.js";
import { ApprovalHolds } from "./approval-holds.js";

/** For a test module that builds Conversations by hand: every Office tool call runs, unruled. */
@Injectable()
export class RunEveryOfficeToolCall implements OnModuleInit {
  constructor(private readonly approvalHolds: ApprovalHolds) {}

  onModuleInit(): void {
    this.approvalHolds.ruleWith(RUN_EVERY_CALL);
  }
}
