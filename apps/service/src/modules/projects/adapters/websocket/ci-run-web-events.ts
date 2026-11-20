import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { CiRunWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { CiRunsChecked } from "../../domain/ci-run-events.js";

/** A listing that changed a Project's CI runs: an open CI page refetches them. */
@Injectable()
export class CiRunWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(CiRunsChecked, changed);
  }
}

function changed(): Omit<CiRunWebEvent, "occurredAt"> {
  return { type: "ci-runs.changed" };
}
