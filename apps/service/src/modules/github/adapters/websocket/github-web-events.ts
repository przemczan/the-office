import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { GitHubWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  GitHubAppRegistered,
  GitHubSignedIn,
  GitHubSignedOut,
} from "../../domain/github-events.js";

type WebEventOf<Type extends GitHubWebEvent["type"]> = Omit<
  Extract<GitHubWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every change to Sign in with GitHub reaches the web as one event, so Settings refetches it. */
@Injectable()
export class GitHubWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(GitHubAppRegistered, changed);
    this.forwarding.forward(GitHubSignedIn, changed);
    this.forwarding.forward(GitHubSignedOut, changed);
  }
}

function changed(): WebEventOf<"github.changed"> {
  return { type: "github.changed" };
}
