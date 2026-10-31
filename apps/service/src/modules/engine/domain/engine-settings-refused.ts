/** Engine settings that break the rules, with every reason, in the UI's words. */
export class EngineSettingsRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "EngineSettingsRefused";
  }
}
