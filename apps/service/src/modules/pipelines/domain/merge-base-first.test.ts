import { describe, expect, it } from "vitest";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import {
  broughtBackBy,
  RESOLVE_BRIEF,
  resolveBrief,
  resolvedByTheUser,
} from "./merge-base-first.js";
import { RESOLVE_TEST_KEY } from "./publish-stages.js";
import { agentStage, gate, publishStage, scriptStage } from "./stage.fixtures.js";
import { aStageRun } from "./stage-run.fixtures.js";
import type { StageRunDecision } from "./stage-run.js";

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
        "Edit each so it keeps what both sides meant, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Read the Task's Plan and what the base changed to judge it. Don't run git: The Office commits the merge once no marker is left, and the Pipeline goes on.",
        "If you can't resolve a conflict, end the Stage failed and say why.",
      ].join("\n\n"),
    );
  });
});

describe("resolvedByTheUser", () => {
  const resolvedInWorktree: StageRunDecision = {
    id: "decision-1",
    kind: "base-moved",
    options: [{ kind: "resolved-in-worktree" }, { kind: "drop" }],
    answer: { kind: "resolved-in-worktree" },
  };
  const resolve = agentStage({ key: "resolve", mergeBaseFirst: true });

  it("reads the run just before, of the same Stage, whatever its key", () => {
    const answered = aStageRun({ stageKey: "resolve", decisions: [resolvedInWorktree] });

    expect(resolvedByTheUser(resolve, [answered])).toBe(true);
    expect(resolvedByTheUser(agentStage({ key: "other" }), [answered])).toBe(false);
  });

  it("doesn't read an answer on an older run of the Stage", () => {
    const answered = aStageRun({ stageKey: "resolve", decisions: [resolvedInWorktree] });
    const later = aStageRun({ number: 2, stageKey: "publish" });

    expect(resolvedByTheUser(resolve, [answered, later])).toBe(false);
  });
});

function carried(stageKey: string) {
  return {
    carriedFailure: { stageKey, error: "Failed.", round: 1, rounds: 2 },
    sentBack: undefined,
  };
}

describe("broughtBackBy", () => {
  const stages = [
    agentStage({ key: "resolve", mergeBaseFirst: true }),
    scriptStage({ key: "test-after-resolve", command: "test" }),
    gate({ key: "review" }),
    publishStage(),
  ];

  it("is a Script Stage's failure, a legacy Test after Resolve's too", () => {
    expect(broughtBackBy(carried("test-after-resolve"), stages)).toBe("script-failure");
    expect(broughtBackBy(carried(`${RESOLVE_TEST_KEY}-2`), stages)).toBe("script-failure");
    // A conflict at Publish is what the merge is for, not a run brought back.
    expect(broughtBackBy(carried("publish"), stages)).toBeUndefined();
  });

  it("is a Gate's Send back", () => {
    expect(
      broughtBackBy(
        { carriedFailure: undefined, sentBack: { gateKey: "review", feedback: "Keep both." } },
        stages,
      ),
    ).toBe("send-back");
  });
});
