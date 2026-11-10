import { describe, expect, it } from "vitest";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";
import {
  addedStageTemplate,
  proposedStageProblems,
  savedStageTemplate,
  stageTemplateFlags,
  stageTemplateProblems,
  templateStage,
  type StageTemplate,
} from "./stage-template.js";
import { StageTemplateAdded, StageTemplateSaved } from "./stage-template-events.js";

const implement: StageTemplate = { id: "implement", stage: agentStage() };

describe("templateStage", () => {
  it("drops a loop target, which only a Pipeline gives meaning, and trims the name", () => {
    expect(
      templateStage(
        scriptStage({ name: " Tests ", onFailure: { goBackTo: "implement", rounds: 2 } }),
      ),
    ).toEqual(scriptStage());
    expect(templateStage(agentStage({ onFailure: { goBackTo: "plan", rounds: 1 } }))).toEqual(
      agentStage(),
    );
    expect(templateStage(gate())).toEqual(gate());
  });
});

describe("stageTemplateProblems", () => {
  it("allows a Stage that can run on its own", () => {
    expect(stageTemplateProblems(scriptStage(), [implement])).toEqual([]);
  });

  it("asks for a name", () => {
    expect(stageTemplateProblems(gate({ name: "  " }), [])).toEqual([{ text: "Give it a name." }]);
  });

  it("refuses a name another template has, in any case", () => {
    expect(stageTemplateProblems(scriptStage({ name: " IMPLEMENT " }), [implement])).toEqual([
      { text: 'Another Stage template is named "IMPLEMENT".' },
    ]);
  });

  it("keeps the rules of a single Stage", () => {
    expect(
      stageTemplateProblems(agentStage({ name: "Draft", role: " ", budget: 0.5 }), []),
    ).toEqual([
      { text: "Choose who works it." },
      { text: "Its budget must be a whole number of tokens above 0." },
    ]);
    expect(
      stageTemplateProblems(
        scriptStage({ publishTarget: "branch-only", afterConflict: "review" }),
        [],
      ),
    ).toEqual([
      { text: "Only a Publish Stage has a publish target." },
      { text: "Only a Publish Stage says what follows a conflict." },
    ]);
  });

  it("leaves the rules about neighbouring Stages to the Pipeline it is added to", () => {
    expect(
      stageTemplateProblems(
        agentStage({
          name: "Review",
          session: "continue",
          onFailure: { goBackTo: "x", rounds: 0 },
        }),
        [],
      ),
    ).toEqual([]);
  });
});

describe("proposedStageProblems", () => {
  const proposed = agentStage({ brief: "Implement the Plan, then run the tests you touched." });

  it("allows a new Stage for a template whose Stage is as it was when proposed", () => {
    // A field left undefined is the same as one left out, as the Stage is kept.
    const drafted = { ...implement.stage, effort: undefined };

    expect(proposedStageProblems(implement, drafted, proposed, [])).toEqual([]);
  });

  it("refuses it once the template's Stage changed since", () => {
    const changed: StageTemplate = { ...implement, stage: agentStage({ budget: 50_000 }) };

    expect(proposedStageProblems(changed, implement.stage, proposed, [])).toEqual([
      { text: "The Implement Stage template changed since this was proposed." },
    ]);
  });

  it("refuses what a template save refuses, and a Stage that changes nothing", () => {
    const tests: StageTemplate = { id: "tests", stage: scriptStage() };

    expect(
      proposedStageProblems(implement, implement.stage, agentStage({ name: "tests" }), [tests]),
    ).toEqual([{ text: 'Another Stage template is named "tests".' }]);
    // The loop target a template doesn't keep changes nothing either.
    const withLoop = agentStage({ onFailure: { goBackTo: "plan", rounds: 1 } });
    expect(proposedStageProblems(implement, implement.stage, withLoop, [])).toEqual([
      { text: "Nothing changes: give the template's Stage as it should be, whole." },
    ]);
  });
});

describe("stageTemplateFlags", () => {
  it("flags a Role whose person was let go, or whose Task limit is none", () => {
    expect(
      stageTemplateFlags(
        agentStage(),
        new Map([["developer", { title: "Developer", person: undefined, letGoPerson: "Ada" }]]),
      ),
    ).toEqual([
      {
        text: "Ada was let go from Developer; hire Ada back, hire someone else, or choose who works it.",
      },
    ]);
    expect(
      stageTemplateFlags(
        agentStage(),
        new Map([
          ["developer", { title: "Developer", person: { name: "Ada", taskLimit: "none" } }],
        ]),
      ),
    ).toEqual([
      { text: "Ada's Task limit is none, so Developer only talks and can't work a Stage." },
    ]);
  });

  it("flags nothing on a Stage no Agent works", () => {
    expect(stageTemplateFlags(scriptStage(), new Map())).toEqual([]);
  });
});

describe("addedStageTemplate and savedStageTemplate", () => {
  it("keep the Stage without its loop target and name the template in their event", () => {
    const stage = scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } });

    expect(addedStageTemplate("tests", stage)).toEqual({
      template: { id: "tests", stage: scriptStage() },
      event: expect.any(StageTemplateAdded),
    });
    const saved = savedStageTemplate("tests", stage);
    expect(saved.template.stage).toEqual(scriptStage());
    expect(saved.event).toBeInstanceOf(StageTemplateSaved);
    expect(saved.event.stageTemplateId).toBe("tests");
  });
});
