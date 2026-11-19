import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { RESOLVE_BRIEF, resolveBrief } from "./resolve-stages.js";

describe("Resolve's Brief", () => {
  it("renders by default exactly the Brief Resolve's Agent was told before it was a Prompt template", () => {
    expect(
      resolveBrief(defaultPromptTexts([RESOLVE_BRIEF]), "main", [
        "src/index.ts",
        "src/<app> & co.ts",
      ]),
    ).toBe(
      [
        "The Task's branch conflicts with main as it now is, which other work moved on. The Office merged main into the branch and left the conflicts in these files:",
        "- src/index.ts\n- src/<app> & co.ts",
        "Edit each so it keeps what both sides meant, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Read the Task's Plan and what the base changed to judge it. Don't run git: The Office commits the merge once no marker is left, then runs the Project's Test.",
        "If you can't resolve a conflict, end the Stage failed and say why: the user is asked.",
      ].join("\n\n"),
    );
  });
});
