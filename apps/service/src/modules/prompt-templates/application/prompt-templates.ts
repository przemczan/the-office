import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { PromptTemplate, PromptTemplateDomain } from "../domain/prompt-template.js";
import { PromptTemplateChanged } from "../domain/prompt-template-events.js";
import { PromptTemplateRefused, refusalOf } from "../domain/prompt-template-refused.js";
import { promptTemplateState, type PromptTemplateState } from "../domain/prompt-template-state.js";
import {
  versionAfter,
  type PromptTemplateChange,
  type PromptTemplateVersion,
} from "../domain/prompt-template-version.js";
import { promptTextProblems, type PromptTextProblem } from "../domain/prompt-text-problems.js";
import { PromptTexts } from "../domain/prompt-texts.js";
import type { UserRef } from "../domain/user.js";
import { PromptTemplateRepository } from "../ports/prompt-template-repository.js";
import { PromptTemplateCatalog } from "./prompt-template-catalog.js";

const CHANGED_SINCE_THE_DRAFT =
  "The prompt template changed after this was drafted, and applying it would overwrite that. Ask for a new draft.";

/**
 * The Prompt templates' texts (spec §2.2): what renders one loads its text when it uses it, so a
 * save reaches the next use; a saved text that no longer passes the check, as after a release
 * removed a variable, renders the default instead.
 */
@Injectable()
export class PromptTemplates {
  private readonly logger = new Logger(PromptTemplates.name);

  constructor(
    private readonly catalog: PromptTemplateCatalog,
    private readonly repository: PromptTemplateRepository,
    private readonly events: EventBus,
  ) {}

  /** The texts the templates render now, in one read; throws for a template not registered. */
  async textsOf(templates: readonly PromptTemplate[]): Promise<PromptTexts> {
    const states = await this.statesOf(templates.map(({ key }) => this.catalog.get(key)));
    return new PromptTexts(
      new Map(
        states.map((state) => {
          if (state.problems.length > 0) {
            this.logger.warn(
              `The saved text of the prompt template ${state.template.key} no longer passes the check, so its default is used: ${state.problems.map(({ message }) => message).join(" ")}`,
            );
          }
          return [state.template.key, state.renderedText];
        }),
      ),
    );
  }

  /** The domain's templates as they stand, or all of them. */
  list(domain?: PromptTemplateDomain): Promise<PromptTemplateState[]> {
    return this.statesOf(this.catalog.byDomain(domain));
  }

  /** Throws PromptTemplateNotFound for a key no module registered. */
  async read(key: string): Promise<PromptTemplateState> {
    const [state] = await this.statesOf([this.catalog.get(key)]);
    return state as PromptTemplateState;
  }

  /** What is wrong with `text` as the template's text, empty when nothing. */
  check(key: string, text: string): PromptTextProblem[] {
    return promptTextProblems(this.catalog.get(key), text);
  }

  /**
   * Saves the text as the template's new version, which keeps the user `savedBy`; refused with
   * every problem when it fails the check. The current text again makes no new version.
   */
  async save(key: string, text: string, savedBy: UserRef): Promise<PromptTemplateState> {
    const template = this.checked(key, text);
    return this.update(template, (current) => versionAfter(current, text, template.text), savedBy);
  }

  /**
   * As `save`, for a Proposal drafted from the text `from`: refused, saving nothing, once the
   * template's text is another, so an edit made since is never overwritten.
   */
  async replace(
    key: string,
    from: string,
    text: string,
    savedBy: UserRef,
  ): Promise<PromptTemplateState> {
    const template = this.checked(key, text);
    return this.update(
      template,
      (current) => {
        if ((current?.text ?? template.text) !== from) {
          throw new PromptTemplateRefused([CHANGED_SINCE_THE_DRAFT]);
        }
        return versionAfter(current, text, template.text);
      },
      savedBy,
    );
  }

  /** Makes the template render its default again, as a new version; nothing while it does already. */
  async resetToDefault(key: string, savedBy: UserRef): Promise<PromptTemplateState> {
    const template = this.catalog.get(key);
    return this.update(template, (current) => versionAfter(current, null, template.text), savedBy);
  }

  private checked(key: string, text: string): PromptTemplate {
    const template = this.catalog.get(key);
    const problems = promptTextProblems(template, text);
    if (problems.length > 0) throw refusalOf(problems);
    return template;
  }

  private async update(
    template: PromptTemplate,
    change: (current: PromptTemplateVersion | undefined) => PromptTemplateChange | undefined,
    savedBy: UserRef,
  ): Promise<PromptTemplateState> {
    let changed = false;
    const saved = await this.repository.update(
      template.key,
      (current) => {
        const next = change(current);
        changed = next !== undefined;
        return next;
      },
      new Date(),
      savedBy,
    );
    if (changed && saved) {
      await this.events.publish(new PromptTemplateChanged(template.key, saved.version));
    }
    return promptTemplateState(template, saved);
  }

  private async statesOf(templates: readonly PromptTemplate[]): Promise<PromptTemplateState[]> {
    const saved = await this.repository.current(templates.map(({ key }) => key));
    return templates.map((template) => promptTemplateState(template, saved.get(template.key)));
  }
}
