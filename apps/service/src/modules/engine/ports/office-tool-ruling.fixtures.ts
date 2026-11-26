import type { OfficeToolRuling } from "./office-tool-ruling.js";

/** A ruling that lets every call run, for a test that is not about the ruling. */
export const RUN_EVERY_CALL: OfficeToolRuling = {
  rule: () => Promise.resolve({ kind: "run" }),
};
