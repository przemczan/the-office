import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { GitHubWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { GitHubAppRegistered } from "../../domain/github-events.js";

type WebEventOf<Type extends GitHubWebEvent["type"]> = Omit<
  Extract<GitHubWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every change to Sign in with GitHub reaches the web as one event, so Settings refetches it. */
@Injectable()
export class GitHubWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(GitHubAppRegistered, (): WebEventOf<"github.changed"> => ({
      type: "github.changed",
    }));
  }
}
