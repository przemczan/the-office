import { OfficeToolRegistry } from "../../../engine/index.js";
import { promptTemplate, type PromptTemplates } from "../../../prompt-templates/index.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import { PromptTemplateProposals } from "../proposals/prompt-template-proposals.js";
import { PromptTemplateOfficeTools } from "./prompt-template-office-tools.js";
import { RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";

// What prompt-template-office-tools.test.ts and its full run share.

/** A template that uses a text and a list of records. */
export const A_GREETING = promptTemplate({
  key: "conversations.a-greeting",
  domain: "conversations",
  name: "A greeting",
  description: "Greets the user.",
  variables: {
    userName: { kind: "text", description: "The user's name." },
    projects: {
      kind: "list",
      description: "The user's Projects.",
      fields: { name: "The Project's name." },
    },
  },
  text: "Hello {{userName}}.",
});

/** A template of another domain. */
export const A_BRIEF = promptTemplate({
  key: "pipelines.a-brief",
  domain: "pipelines",
  name: "A Brief",
  description: "Briefs a Stage.",
  variables: { title: { kind: "text", description: "The Task's title." } },
  text: "Work on {{title}}.",
});

/**
 * The prompt template Office tools over `templates`, and the Proposals' applier of the prompt
 * template kind, which open Proposals of it still go through.
 */
export function promptTemplateTools(templates: PromptTemplates) {
  const appliers = new ProposalAppliers();
  new PromptTemplateProposals(appliers, templates).onModuleInit();
  const registry = new OfficeToolRegistry();
  new PromptTemplateOfficeTools(registry, templates).onModuleInit();
  const tool = (name: string) => {
    const [named] = registry.named([name], RUN_EVERY_CALL);
    if (!named) throw new Error(`${name} is not registered.`);
    return named;
  };
  return { tool, appliers };
}
