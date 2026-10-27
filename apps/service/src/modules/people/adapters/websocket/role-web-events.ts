import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { RoleWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  RoleCardChanged,
  RoleHired,
  RoleHiredBack,
  RoleLetGo,
  RoleMemoryChanged,
} from "../../domain/role-events.js";

type WebEventOf<Type extends RoleWebEvent["type"]> = Omit<
  Extract<RoleWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every People event reaches the web, naming the Role, so an open page refetches it. */
@Injectable()
export class RoleWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(RoleHired, (event): WebEventOf<"role.hired"> => ({
      type: "role.hired",
      roleKey: event.role.key,
    }));
    this.forwarding.forward(RoleLetGo, (event): WebEventOf<"role.let-go"> => ({
      type: "role.let-go",
      roleKey: event.role.key,
    }));
    this.forwarding.forward(RoleHiredBack, (event): WebEventOf<"role.hired-back"> => ({
      type: "role.hired-back",
      roleKey: event.role.key,
    }));
    this.forwarding.forward(RoleCardChanged, (event): WebEventOf<"role.card-changed"> => ({
      type: "role.card-changed",
      roleKey: event.role.key,
    }));
    this.forwarding.forward(RoleMemoryChanged, (event): WebEventOf<"role.memory-changed"> => ({
      type: "role.memory-changed",
      roleKey: event.roleKey,
    }));
  }
}
