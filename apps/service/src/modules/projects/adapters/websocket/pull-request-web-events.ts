import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { PullRequestWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PullRequestOpened, PullRequestsChecked } from "../../domain/pull-request-events.js";

/** A pull request opened or a refresh that changed the list: an open Pull requests page refetches. */
@Injectable()
export class PullRequestWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(PullRequestOpened, changed);
    this.forwarding.forward(PullRequestsChecked, changed);
  }
}

function changed(): Omit<PullRequestWebEvent, "occurredAt"> {
  return { type: "pull-requests.changed" };
}
