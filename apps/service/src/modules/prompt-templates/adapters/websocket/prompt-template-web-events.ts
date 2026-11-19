import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { PromptTemplateWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PromptTemplateChanged } from "../../domain/prompt-template-events.js";

/** A template's save or reset reaches the web by its key, so an open Settings page reads it again. */
@Injectable()
export class PromptTemplateWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwarding.forward(
      PromptTemplateChanged,
      ({ key }): Omit<PromptTemplateWebEvent, "occurredAt"> => ({
        type: "prompt-template.changed",
        key,
      }),
    );
  }
}
