import { queryOptions } from "@tanstack/react-query";
import {
  promptTemplateListSchema,
  promptTemplateRefusalSchema,
  promptTemplateSchema,
  type PromptTemplate,
  type PromptTemplateWebEvent,
} from "@the-office/contracts";
import { deleteFromApiReturning, getFromApi, sendToApiRefusedAs } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

/** Every Prompt templates query starts with this, so one invalidation reaches all of them. */
export const PROMPT_TEMPLATES = ["settings", "prompt-templates"] as const;

export const promptTemplateQueries = {
  /** Every template of the catalog, in one read for all of Settings' tabs. */
  list: () =>
    queryOptions({
      queryKey: [...PROMPT_TEMPLATES, "list"],
      queryFn: ({ signal }) =>
        getFromApi("/settings/prompt-templates", promptTemplateListSchema, signal),
    }),
  read: (key: string) =>
    queryOptions({
      queryKey: [...PROMPT_TEMPLATES, "template", key],
      queryFn: ({ signal }) => getFromApi(promptTemplatePath(key), promptTemplateSchema, signal),
    }),
};

/**
 * Saves the text as the template's new version. A text that fails the check is refused (422) as
 * `RefusedAs` with a `PromptTemplateRefusal`, which carries each problem with its line and column.
 */
export function savePromptTemplate(key: string, text: string): Promise<PromptTemplate> {
  return sendToApiRefusedAs(
    "PUT",
    promptTemplatePath(key),
    { text },
    promptTemplateSchema,
    promptTemplateRefusalSchema,
  );
}

/** Makes the template render its default text again. */
export function resetPromptTemplate(key: string): Promise<PromptTemplate> {
  return deleteFromApiReturning(promptTemplatePath(key), promptTemplateSchema);
}

/** A save or reset made anywhere reads the list and that template again. */
export const promptTemplateEventInvalidations: Readonly<
  Record<PromptTemplateWebEvent["type"], EventInvalidations[string]>
> = {
  "prompt-template.changed": () => [PROMPT_TEMPLATES],
};

function promptTemplatePath(key: string): `/${string}` {
  return `/settings/prompt-templates/${encodeURIComponent(key)}`;
}
