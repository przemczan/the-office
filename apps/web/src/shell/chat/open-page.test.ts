import { describe, expect, it } from "vitest";
import { openPageOf, type MatchedRoute } from "./open-page.ts";

const TASK_ID = "3b1f6f0e-0000-4000-8000-000000000001";
const ROOT: MatchedRoute = { routeId: "__root__", params: {}, search: {} };

function matched(routeId: string, params: object = {}, search: object = {}): MatchedRoute[] {
  return [ROOT, { routeId, params, search }];
}

describe("the Open page of the routes matched", () => {
  it("is the Task on a Task's page, a Decision window on it too", () => {
    const decision = { decision: "d-1", taskThread: "t-1" };

    expect(openPageOf(matched("/tasks/$taskId", { taskId: TASK_ID }, decision))).toEqual({
      kind: "task",
      taskId: TASK_ID,
    });
  });

  it("is the Initiative on its page", () => {
    expect(
      openPageOf(matched("/work/initiatives/$initiativeId", { initiativeId: TASK_ID })),
    ).toEqual({ kind: "initiative", initiativeId: TASK_ID });
  });

  it("is the Idea open on Work › Ideas, and none without one", () => {
    const ideas = [ROOT, { routeId: "/work", params: {}, search: {} }];

    expect(
      openPageOf([...ideas, { routeId: "/work/ideas", params: {}, search: { idea: TASK_ID } }]),
    ).toEqual({ kind: "idea", ideaId: TASK_ID });
    expect(openPageOf([...ideas, { routeId: "/work/ideas", params: {}, search: {} }])).toBe(
      undefined,
    );
  });

  it("is the person on any tab of their page", () => {
    const person = { routeId: "/people/$roleKey", params: { roleKey: "cto" }, search: {} };
    const tab = { routeId: "/people/$roleKey/memory", params: { roleKey: "cto" }, search: {} };

    expect(openPageOf([ROOT, person, tab])).toEqual({ kind: "person", roleKey: "cto" });
  });

  it("is the Project on any section of its page", () => {
    const project = {
      routeId: "/projects/$projectId",
      params: { projectId: "admin-panel" },
      search: {},
    };
    const section = { ...project, routeId: "/projects/$projectId/commands" };

    expect(openPageOf([ROOT, project, section])).toEqual({
      kind: "project",
      projectId: "admin-panel",
    });
  });

  it("is none on any other page", () => {
    expect(openPageOf(matched("/now"))).toBeUndefined();
    expect(openPageOf(matched("/work/"))).toBeUndefined();
    expect(openPageOf(matched("/settings/pipelines/$pipelineId", { pipelineId: "full" }))).toBe(
      undefined,
    );
    expect(openPageOf([ROOT])).toBeUndefined();
  });
});
