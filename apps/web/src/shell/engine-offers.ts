import type { EngineKind, RoleCardOptions } from "@the-office/contracts";
import { modelLabel, noLongerOfferedModelLabel } from "./engine-words.ts";
import { ENGINES_DEFAULT } from "./role-card-words.ts";

/** What an engine type offers to choose from, and the choices of a Model field, wherever the web sets one. */

/** A Model or Effort field's first choice, "Engine's default" or "Person's setting": nothing set. */
export const ENGINES_DEFAULT_CHOICE = "";

/** The models and efforts a type offers, as the Role card's options list them. */
export interface TypeOffer {
  readonly models: readonly string[];
  readonly efforts: RoleCardOptions["engineTypes"][number]["efforts"];
}

export function typeOfferOf(options: RoleCardOptions | undefined, type: EngineKind): TypeOffer {
  const offered = options?.engineTypes.find((entry) => entry.type === type);
  return {
    models: offered?.models.map(({ model }) => model) ?? [],
    efforts: offered?.efforts ?? [],
  };
}

/**
 * A Model field's choices: `first` ("Engine's default" or "Person's setting"), then the type's
 * models; one saved that the type no longer offers stays, marked, until it is changed.
 */
export function modelChoices(
  models: readonly string[],
  saved: string | null,
  first: string = ENGINES_DEFAULT,
): { value: string; label: string }[] {
  return [
    { value: ENGINES_DEFAULT_CHOICE, label: first },
    ...models.map((model) => ({ value: model, label: modelLabel(model) })),
    ...(saved !== null && !models.includes(saved)
      ? [{ value: saved, label: noLongerOfferedModelLabel(saved) }]
      : []),
  ];
}
