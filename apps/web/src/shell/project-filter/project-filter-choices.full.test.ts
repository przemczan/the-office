import type { Project } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  inOtherProjectsWords,
  knownProjectFilter,
  narrowed,
  onlyProject,
  onlyProjectShown,
  projectFilterLabel,
  withProjectToggled,
} from "./project-filter-choices.ts";

const PROJECT_IDS = ["firmware", "mobile", "web"];

describe("the Project filter's choices", () => {
  it("turns a Project off under All projects, leaving the others shown", () => {
    expect(withProjectToggled("all", "mobile", PROJECT_IDS)).toEqual(["firmware", "web"]);
  });

  it("turns a Project on, and becomes All projects once every one is shown", () => {
    expect(withProjectToggled(["firmware"], "web", PROJECT_IDS)).toEqual(["firmware", "web"]);
    expect(withProjectToggled(["firmware", "web"], "mobile", PROJECT_IDS)).toBe("all");
  });

  it("keeps the last Project shown on, as none is no choice", () => {
    expect(withProjectToggled(["web"], "web", PROJECT_IDS)).toEqual(["web"]);
    expect(withProjectToggled("all", "web", ["web"])).toBe("all");
  });

  it("shows one Project alone, or All projects when it is the only one", () => {
    expect(onlyProject("mobile", PROJECT_IDS)).toEqual(["mobile"]);
    expect(onlyProject("web", ["web"])).toBe("all");
  });

  it("leaves out Projects The Office no longer has, showing all when none is left", () => {
    expect(knownProjectFilter(["gone", "web"], PROJECT_IDS)).toEqual(["web"]);
    expect(knownProjectFilter(["gone"], PROJECT_IDS)).toBe("all");
    expect(knownProjectFilter("all", PROJECT_IDS)).toBe("all");
  });

  it("names the one Project shown, which a new record defaults to", () => {
    expect(onlyProjectShown(["web"])).toBe("web");
    expect(onlyProjectShown(["web", "mobile"])).toBeUndefined();
    expect(onlyProjectShown("all")).toBeUndefined();
  });

  it("labels the choice", () => {
    const projects = [{ id: "web", name: "Web app" }] as Project[];
    expect(projectFilterLabel("all", projects)).toBe("All projects");
    expect(projectFilterLabel(["web"], projects)).toBe("Web app");
    expect(projectFilterLabel(["web", "mobile"], projects)).toBe("2 projects");
  });

  it("counts what is in other Projects", () => {
    expect(inOtherProjectsWords(1, "Task", "Tasks")).toBe("1 more Task in other Projects");
    expect(inOtherProjectsWords(3, "Task", "Tasks")).toBe("3 more Tasks in other Projects");
    expect(inOtherProjectsWords(1, "needs you", "need you")).toBe(
      "1 more needs you in other Projects",
    );
    expect(inOtherProjectsWords(2, "Project", "Projects", "hidden by the Project filter")).toBe(
      "2 more Projects hidden by the Project filter",
    );
  });
});

describe("narrowed", () => {
  it("keeps the records the filter shows and counts the others", () => {
    const tasks = [{ projectId: "web" }, { projectId: "mobile" }, { projectId: "web" }];

    expect(narrowed(tasks, ({ projectId }) => projectId === "web")).toEqual({
      shown: [{ projectId: "web" }, { projectId: "web" }],
      elsewhere: 1,
    });
  });
});
