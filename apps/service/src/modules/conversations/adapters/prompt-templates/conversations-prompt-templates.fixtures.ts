import { Module } from "@nestjs/common";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { PromptTemplatesModule } from "../../../prompt-templates/index.js";
import { ConversationsPromptTemplates } from "./conversations-prompt-templates.js";

/**
 * For a test app that provides Conversations' services itself, not through its module: the catalog
 * with Conversations' templates in it, and `PromptTemplates` to load their texts, which publishes
 * on the event bus.
 */
@Module({
  imports: [EventsModule, PromptTemplatesModule],
  providers: [ConversationsPromptTemplates],
  exports: [PromptTemplatesModule],
})
export class ConversationsPromptTemplatesForTests {}
