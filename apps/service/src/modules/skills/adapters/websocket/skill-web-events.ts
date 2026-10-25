import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { SkillWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  SkillAdded,
  SkillEveryoneChanged,
  SkillRemoved,
  SkillTurnedOff,
  SkillTurnedOn,
  SkillVersionSaved,
} from "../../domain/skill-events.js";

type WebEventOf<Type extends SkillWebEvent["type"]> = Omit<
  Extract<SkillWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every library event reaches the web, naming the skill, so an open page refetches it. */
@Injectable()
export class SkillWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(SkillAdded, (event): WebEventOf<"skill.added"> => ({
      type: "skill.added",
      skillName: event.skill.name,
    }));
    this.forwarding.forward(SkillVersionSaved, (event): WebEventOf<"skill.version-saved"> => ({
      type: "skill.version-saved",
      skillName: event.skill.name,
    }));
    this.forwarding.forward(SkillTurnedOn, (event): WebEventOf<"skill.turned-on"> => ({
      type: "skill.turned-on",
      skillName: event.skillName,
    }));
    this.forwarding.forward(SkillTurnedOff, (event): WebEventOf<"skill.turned-off"> => ({
      type: "skill.turned-off",
      skillName: event.skillName,
    }));
    this.forwarding.forward(
      SkillEveryoneChanged,
      (event): WebEventOf<"skill.everyone-changed"> => ({
        type: "skill.everyone-changed",
        skillName: event.skillName,
      }),
    );
    this.forwarding.forward(SkillRemoved, (event): WebEventOf<"skill.removed"> => ({
      type: "skill.removed",
      skillName: event.skillName,
    }));
  }
}
