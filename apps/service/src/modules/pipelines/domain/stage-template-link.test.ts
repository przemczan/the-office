import { describe, expect, it } from "vitest";
import { agentStage, dutyStage, gate, scriptStage } from "./stage.fixtures.js";
import {
  fieldsDiffering,
  templateFields,
  unlinked,
  unlinkedFrom,
  withLiveLinks,
  withTemplateFields,
} from "./stage-template-link.js";
import { templateStage } from "./stage-template.js";

const TEMPLATE = agentStage({
  key: "review",
  name: "Review",
  brief: "Review it.",
  budget: 200_000,
});

const linked = agentStage({
  ...TEMPLATE,
  key: "review-2",
  name: "Review again",
  templateId: "review",
  routes: [{ to: null, condition: null }],
  place: { column: 3, row: 0 },
  onFailure: { goBackTo: "implement", rounds: 2 },
});

describe("templateFields", () => {
  it("leaves out what names the Stage in its Pipeline, its routes, place, loop and link, and takes Role and duty as one", () => {
    expect(Object.keys(templateFields(linked)).toSorted()).toEqual([
      "brief",
      "budget",
      "session",
      "who",
    ]);
    expect(templateFields(dutyStage("implements")).who).toEqual({ duty: "implements" });
  });

  it("covers any field a Stage carries, as kept", () => {
    expect(templateFields(scriptStage({ publishTarget: undefined }))).toEqual({ command: "test" });
    expect(templateFields(agentStage({ effort: "high" })).effort).toBe("high");
  });
});

describe("fieldsDiffering", () => {
  it("is empty for a Stage whose name, key, routes, place and loop alone differ", () => {
    expect(fieldsDiffering(linked, TEMPLATE)).toEqual([]);
  });

  it("names each field that differs, a field left out on one side included", () => {
    const edited = {
      ...linked,
      budget: 300_000,
      effort: "max" as const,
      duty: "implements" as const,
    };
    const { role: _role, ...noRole } = edited;

    expect(fieldsDiffering(noRole, TEMPLATE)).toEqual(["who", "budget", "effort"]);
  });

  it("compares an undefined field as left out", () => {
    expect(fieldsDiffering({ ...linked, effort: undefined }, TEMPLATE)).toEqual([]);
  });
});

describe("withTemplateFields", () => {
  it("sets the named fields to the template's and keeps the rest, the link too", () => {
    const edited = agentStage({ ...linked, budget: 1, brief: "Own brief." });

    const taken = withTemplateFields(edited, TEMPLATE, ["budget"]);

    expect(taken).toEqual({ ...edited, budget: 200_000 });
  });

  it("takes who works it whole, a Role for a duty", () => {
    const { role: _role, ...onDuty } = { ...linked, duty: "implements" as const };

    const taken = withTemplateFields(onDuty, TEMPLATE, ["who"]);

    expect(taken).toMatchObject({ role: "developer" });
    expect("duty" in taken).toBe(false);
  });

  it("removes a field the template leaves out, and never touches the Pipeline's fields", () => {
    const edited = agentStage({ ...linked, effort: "max" });

    const taken = withTemplateFields(edited, TEMPLATE, ["effort", "name", "routes"]);

    expect("effort" in taken).toBe(false);
    expect(taken.name).toBe("Review again");
    expect(taken.routes).toEqual(linked.routes);
  });

  it("gives nothing from a template of another kind", () => {
    expect(withTemplateFields(linked, gate(), ["brief"])).toBe(linked);
  });
});

describe("links", () => {
  it("unlinks every Stage, or only those of one template, their fields kept", () => {
    const other = { ...gate(), templateId: "other" };

    expect(unlinked([linked, other])).toEqual([
      (({ templateId: _templateId, ...rest }) => rest)(linked),
      gate(),
    ]);
    expect(unlinkedFrom("review", [linked, other])[1]).toBe(other);
  });

  it("keeps only links to a template that exists and is of the Stage's kind", () => {
    const gateLinkedToAgent = { ...gate(), templateId: "review" };
    const gone = { ...scriptStage(), templateId: "gone" };

    const kept = withLiveLinks(
      [linked, gateLinkedToAgent, gone],
      [{ id: "review", stage: TEMPLATE }],
    );

    expect(kept.map(({ templateId }) => templateId)).toEqual(["review", undefined, undefined]);
  });

  it("is never kept on a template's own Stage", () => {
    expect(templateStage(linked).templateId).toBeUndefined();
  });
});
