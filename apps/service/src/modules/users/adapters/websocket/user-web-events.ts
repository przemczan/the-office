import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { UserWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { UserChanged, UserCreated, UserRemoved } from "../../domain/user-events.js";

type WebEventOf<Type extends UserWebEvent["type"]> = Omit<
  Extract<UserWebEvent, { type: Type }>,
  "occurredAt"
>;

/** A user added, changed or removed reaches the web, naming the user, so Settings › Users refetches. */
@Injectable()
export class UserWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(UserCreated, (event): WebEventOf<"user.created"> => ({
      type: "user.created",
      userId: event.userId,
    }));
    this.forwarding.forward(UserChanged, (event): WebEventOf<"user.changed"> => ({
      type: "user.changed",
      userId: event.userId,
    }));
    this.forwarding.forward(UserRemoved, (event): WebEventOf<"user.removed"> => ({
      type: "user.removed",
      userId: event.userId,
    }));
  }
}
