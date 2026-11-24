import type { Stage, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  pipelineShapeWords,
  pipelinesFoldedLine,
  pipelinesFootWords,
  pipelinesStartOpen,
  shortNameFormProblem,
  shortNameFromTitle,
  stackedLoopBackWords,
  trackLayout,
  trackStageWords,
  type ProjectPublishing,
} from "./initiative-pipeline-words.ts";

const INTEGRATE: Stage = {
  kind: "script",
  key: "integrate",
  name: "Integrate",
  optional: false,
  command: "integrate",
};
const REVIEW: Stage = { kind: "gate", key: "review", name: "Your review", optional: false };
const PUBLISH: Stage = {
  kind: "publish",
  key: "publish",
  name: "Publish",
  optional: true,
};

function aTaskStage(stage: Stage, state: TaskStage["state"]): TaskStage {
  return { stage, state, tokens: NO_TOKENS, wentBack: null, runs: [] };
}

const SHIPPING: ProjectPublishing = {
  projectName: "not-astray",
  pipelineName: "Ship an Initiative",
  publishingTask: undefined,
};
const STRAIGHT: ProjectPublishing = {
  projectName: "notnullsoft",
  pipelineName: "Publish straight away",
  publishingTask: undefined,
};
const ON_NONE: ProjectPublishing = {
  projectName: "docs",
  pipelineName: null,
  publishingTask: undefined,
};

const STAGE_NAMES: Readonly<Record<string, string>> = { review: "Check", integrate: "Integrate" };

function nameOf(key: string): string {
  return STAGE_NAMES[key] ?? key;
}

function published(project: ProjectPublishing): ProjectPublishing {
  return { ...project, publishingTask: { state: "done", stages: [] } };
}

function added(state: "ready" | "in-progress"): ProjectPublishing["publishingTask"] {
  return { state, stages: [] };
}

describe("a Project's track", () => {
  it("lies across while each Stage gets 96 pixels of its own width, and stacks under that", () => {
    expect(trackLayout(480, 5)).toBe("across");
    expect(trackLayout(479, 5)).toBe("stacked");
    expect(trackLayout(672, 7)).toBe("across");
    expect(trackLayout(358, 4)).toBe("stacked");
    expect(trackLayout(358, 3)).toBe("across");
  });

  it("says a reached Stage's state, else who works it, an optional one no differently", () => {
    expect(trackStageWords(aTaskStage(REVIEW, "waiting-on-you"), "waits for you")).toBe(
      "Waiting on you",
    );
    expect(trackStageWords(aTaskStage(INTEGRATE, "pending"), "verify")).toBe("verify");
    expect(trackStageWords(aTaskStage(PUBLISH, "pending"), "publish")).toBe("publish");
    expect(trackStageWords(aTaskStage(PUBLISH, "not-taken"), "publish")).toBe("Not taken");
  });

  it("says a loop-back in words when stacked, with its limit or No limit", () => {
    expect(
      stackedLoopBackWords({ from: "review", to: "integrate", count: 1, limit: 2 }, nameOf),
    ).toBe("Check went back to Integrate, 1 of at most 2");
    expect(
      stackedLoopBackWords({ from: "review", to: "integrate", count: 2, limit: null }, nameOf),
    ).toBe("Check went back to Integrate, 2 times");
  });

  it("counts a Pipeline's Stages and Gates", () => {
    expect(pipelineShapeWords([INTEGRATE, REVIEW, PUBLISH])).toBe("3 Stages, 1 Gate");
    expect(pipelineShapeWords([PUBLISH])).toBe("1 Stage, no Gate");
  });
});

describe("the Pipelines card's folded line", () => {
  it("names each Project's Pipeline while shaping and before the Publishing Tasks", () => {
    expect(
      pipelinesFoldedLine("shaping", [SHIPPING, STRAIGHT, ON_NONE], { made: 0, kept: 0 }),
    ).toBe("not-astray: Ship an Initiative · notnullsoft: Publish straight away · docs: None");
    expect(pipelinesFoldedLine("shaping", [ON_NONE], { made: 0, kept: 0 })).toBe(
      "None: each Task publishes on its own",
    );
    expect(pipelinesFoldedLine("active", [SHIPPING, STRAIGHT], { made: 2, kept: 2 })).toBe(
      "not-astray: Ship an Initiative · notnullsoft: Publish straight away · start once every Task is Done or Dropped",
    );
  });

  it("says where each Publishing Task is", () => {
    const waiting: ProjectPublishing = {
      ...SHIPPING,
      publishingTask: {
        state: "in-progress",
        stages: [aTaskStage(INTEGRATE, "done"), aTaskStage(REVIEW, "waiting-on-you")],
      },
    };
    const integrating: ProjectPublishing = {
      ...STRAIGHT,
      publishingTask: {
        state: "in-progress",
        stages: [aTaskStage(INTEGRATE, "running"), aTaskStage(PUBLISH, "pending")],
      },
    };

    expect(
      pipelinesFoldedLine("active", [waiting, integrating, ON_NONE], { made: 2, kept: 2 }),
    ).toBe("not-astray at Your review, waiting on you · notnullsoft at Integrate");
  });

  it("says how it ended, and None once confirmed with None everywhere", () => {
    expect(
      pipelinesFoldedLine("done", [published(SHIPPING), published(STRAIGHT)], { made: 2, kept: 2 }),
    ).toBe("Published in 2 Projects");
    expect(pipelinesFoldedLine("dropped", [SHIPPING, STRAIGHT], { made: 2, kept: 2 })).toBe(
      "Dropped · 2 branches kept",
    );
    expect(pipelinesFoldedLine("dropped", [SHIPPING, STRAIGHT], { made: 2, kept: 1 })).toBe(
      "Dropped · 1 branch kept",
    );
    expect(pipelinesFoldedLine("dropped", [SHIPPING, STRAIGHT], { made: 2, kept: 0 })).toBe(
      "Dropped · branches deleted",
    );
    expect(pipelinesFoldedLine("dropped", [SHIPPING, STRAIGHT], { made: 0, kept: 0 })).toBe(
      "Dropped · no Initiative's branch was made",
    );
    expect(pipelinesFoldedLine("active", [ON_NONE], { made: 0, kept: 0 })).toBe(
      "None: publishes Task by Task",
    );
  });
});

describe("the Pipelines card's foot line", () => {
  it("says what comes, what can still change, then why the Pipelines no longer change", () => {
    expect(pipelinesFootWords("active", [SHIPPING, STRAIGHT])).toContain(
      "A Project's Pipeline can still change, by Edit or a Proposal of whoever shapes Initiatives, until its Publishing Task starts.",
    );
    expect(
      pipelinesFootWords("active", [
        { ...SHIPPING, publishingTask: added("in-progress") },
        { ...STRAIGHT, publishingTask: added("ready") },
      ]),
    ).toBe(
      "A Project's Pipeline can still change, by Edit or a Proposal of whoever shapes Initiatives, until its Publishing Task starts.",
    );
    expect(
      pipelinesFootWords("active", [
        { ...SHIPPING, publishingTask: added("in-progress") },
        ON_NONE,
      ]),
    ).toBe("Their Publishing Tasks have started, so these Pipelines no longer change.");
    expect(pipelinesFootWords("dropped", [SHIPPING])).toBe(
      "Dropped: no Publishing Task is added any more.",
    );
    expect(pipelinesFootWords("active", [ON_NONE])).toBeUndefined();
  });
});

describe("whether the Pipelines card starts open", () => {
  it("starts folded only once confirmed with None in every Project", () => {
    const none = [
      { projectId: "a", pipelineId: null },
      { projectId: "b", pipelineId: null },
    ];
    expect(pipelinesStartOpen({ state: "shaping", pipelines: [] })).toBe(true);
    expect(pipelinesStartOpen({ state: "active", pipelines: none })).toBe(false);
    expect(
      pipelinesStartOpen({
        state: "active",
        pipelines: [...none, { projectId: "c", pipelineId: "full" }],
      }),
    ).toBe(true);
  });
});

describe("the branch name the editor fills in and checks", () => {
  it("makes it from the title as the service does: accents dropped, one - between words, cut at a word", () => {
    expect(shortNameFromTitle("Gęślą jaźń: Café!")).toBe("gesla-jazn-cafe");
    expect(shortNameFromTitle("  --Sync, now!-- ")).toBe("sync-now");
    expect(shortNameFromTitle("word ".repeat(10))).toBe("word-word-word-word-word-word-word-word");
    expect(shortNameFromTitle("a".repeat(50))).toBe("a".repeat(40));
  });

  it("asks for a name, then lower-case words joined by single dashes", () => {
    expect(shortNameFormProblem("usage-exports-2")).toBeUndefined();
    expect(shortNameFormProblem("")).toContain("Name the branch");
    for (const outOfForm of ["Usage", "usage exports", "-usage", "usage--exports", "usage-"]) {
      expect(shortNameFormProblem(outOfForm)).toContain("Use only lower-case");
    }
  });
});
