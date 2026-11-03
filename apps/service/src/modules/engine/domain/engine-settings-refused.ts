/** Engine settings that break the rules, with every reason, in the UI's words. */
export class EngineSettingsRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "EngineSettingsRefused";
  }
}

/** The engines a page was read with are no longer the ones listed, as when another tab saved. */
export const ENGINES_CHANGED_MEANWHILE = "The engines changed meanwhile; reload the page.";
