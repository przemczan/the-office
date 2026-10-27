import type { FiveHourWindow } from "../domain/now.js";

/** The account's usage windows as the Engine last read them; the composition root binds it. */
export abstract class AccountUsage {
  /** Undefined until the engine first reports them. */
  abstract readonly current: { readonly fiveHour: FiveHourWindow } | undefined;
}
