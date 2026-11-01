import { describe, expect, it } from "vitest";
import { pushFailure } from "./publication.js";

const origin = { remote: "origin", branch: "office/task-1" };

describe("pushFailure", () => {
  it.each([
    "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission",
    "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope",
  ])(
    "names the App's Workflows permission when GitHub refuses a change to workflows: %s",
    (why) => {
      const said = `! [remote rejected] office/task-1 -> office/task-1 (${why})`;

      expect(pushFailure("office/task-1", origin, said)).toBe(
        `GitHub refused the push of office/task-1 to office/task-1 on origin: the change touches .github/workflows, which needs the GitHub App's Workflows permission. Accept the App's permissions on GitHub if it asks, or register it again from Settings › Office identity, then run Publish again. git said: ${said}`,
      );
    },
  );

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
