import { describe, expect, it } from "vitest";
import { pushFailure } from "./publication.js";

const origin = { remote: "origin", branch: "office/task-1" };

describe("pushFailure", () => {
  it("says which scope the credentials lack when GitHub refuses a change to workflows", () => {
    const said =
      "! [remote rejected] office/task-1 -> office/task-1 (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)";

    expect(pushFailure("office/task-1", origin, said)).toBe(
      `GitHub refused the push of office/task-1 to office/task-1 on origin: the change touches .github/workflows, which needs credentials with the \`workflow\` scope, and yours lack it. Add the scope with \`gh auth refresh -s workflow\` (or use a token that has it), then run Publish again. git said: ${said}`,
    );
  });

  it("says the remote has commits the branch doesn't when the push isn't a fast-forward", () => {
    const said =
      "! [rejected] office/task-1 -> main (fetch first)\nerror: failed to push some refs";

    expect(pushFailure("office/task-1", { remote: "origin", branch: "main" }, said)).toBe(
      `origin refused the push of office/task-1 to main on origin: it has commits the Task's branch doesn't. git said: ${said}`,
    );
  });

  it("hands on git's own words otherwise", () => {
    expect(pushFailure("office/task-1", origin, "fatal: Authentication failed")).toBe(
      "Pushing office/task-1 to office/task-1 on origin failed. git said: fatal: Authentication failed",
    );
  });
});
