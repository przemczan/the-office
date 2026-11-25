import { describe, expect, it } from "vitest";
import {
  actionProblems,
  editedActions,
  markedAction,
  reservedEnvironmentProblems,
  setByAfter,
  type Action,
  type ActionContext,
  type ActionFields,
  type ActionSetter,
} from "./action.js";
import {
  appliedActions,
  proposedActions,
  proposedActionsProblems,
  type ProposedActions,
} from "./proposed-actions.js";
import { ProjectRefused } from "./project-refused.js";

const CONTEXT: ActionContext = {
  projectName: "Shop",
  commandKeys: ["build", "lint"],
  commandBeforeKeys: ["install", "build", "lint"],
  targetKeys: ["android"],
  deviceIds: ["device-1"],
  variables: [],
};

const ANN: ActionSetter = { by: "user", user: { userId: "user-ann", name: "Ann" } };
const DANA: ActionSetter = {
  by: "proposal",
  proposalId: "proposal-1",
  agent: { roleKey: "devops", name: "Dana" },
};

const BUILD: ActionFields = {
  key: "build-web",
  name: "Build web",
  kind: "project-command",
  settings: {
    commandKey: "build",
    commandsBefore: ["install"],
    timeLimitMinutes: null,
    projectDeviceId: null,
  },
  leavesTheWorkstation: false,
};

const PHONE: ActionFields = {
  key: "phone",
  name: "Install on my phone",
  kind: "test-target",
  settings: { targetKey: "android" },
  leavesTheWorkstation: false,
};

const RELEASE: ActionFields = {
  key: "release",
  name: "Release",
  kind: "workflow",
  settings: { file: "release.yml", inputs: { channel: "stable" } },
  leavesTheWorkstation: false,
};

function kept(fields: ActionFields, setBy: Action["setBy"] = {}): Action {
  return { ...fields, setBy };
}

const holding = (projectDeviceId: string): ActionFields => ({
  ...BUILD,
  settings: { ...BUILD.settings, projectDeviceId },
});

describe("an Action's rules", () => {
  it("take each kind naming what the Project has", () => {
    expect(actionProblems([BUILD, PHONE, RELEASE], CONTEXT)).toEqual([]);
  });

  it("refuse, naming the value, what the Project doesn't have and what breaks the page's rules", () => {
    expect(
      actionProblems(
        [
          {
            ...BUILD,
            key: "Build",
            name: "x".repeat(61),
            settings: {
              commandKey: "deploy",
              commandsBefore: ["seed"],
              timeLimitMinutes: 241,
              projectDeviceId: null,
            },
          },
          { ...PHONE, settings: { targetKey: "ios" } },
          { ...PHONE, name: "" },
          { ...RELEASE, settings: { file: "", inputs: {} } },
        ],
        CONTEXT,
      ),
    ).toEqual([
      "The key phone is taken by another Action.",
      `Action "Build": An Action's key is lower-case letters, digits and "-", starting with a letter; "Build" is not.`,
      `Action "Build": Its name may be at most 60 characters.`,
      `Action "Build": deploy isn't one of «Shop»'s commands.`,
      `Action "Build": seed, among the commands before it, isn't one of «Shop»'s commands.`,
      `Action "Build": Its time limit is a whole number of minutes from 1 to 240.`,
      `Action "phone": ios isn't one of «Shop»'s test targets.`,
      `Action "phone": Give it a name.`,
      `Action "release": Give the Workflow's file, such as release.yml.`,
    ]);
  });

  it("take a Project command Action holding one of the Project's devices, and refuse one it hasn't", () => {
    expect(actionProblems([holding("device-1")], CONTEXT)).toEqual([]);
    expect(actionProblems([holding("device-9")], CONTEXT)).toEqual([
      `Action "build-web": device-9 isn't one of «Shop»'s devices.`,
    ]);
  });

  it("refuse a Project command Action while a Project variable takes a name The Office sets", () => {
    const context = {
      ...CONTEXT,
      variables: [{ name: "OFFICE_ACTION" }, { name: "OFFICE_ACTION_COMMIT" }, { name: "PATH" }],
    };

    expect(actionProblems([BUILD, PHONE], context)).toEqual([
      `Action "build-web": OFFICE_ACTION is a variable The Office sets in an Action's run; rename the Project variable.`,
      `Action "build-web": OFFICE_ACTION_COMMIT is a variable The Office sets in an Action's run; rename the Project variable.`,
    ]);
    expect(actionProblems([PHONE, RELEASE], context)).toEqual([]);
  });

  it("refuse such a Project variable while the Project has a Project command Action", () => {
    expect(reservedEnvironmentProblems([{ name: "OFFICE_ACTION_BRANCH" }], [BUILD])).toEqual([
      "OFFICE_ACTION_BRANCH is a variable The Office sets in an Action's run, such as Build web's; give the Project variable another name.",
    ]);
    expect(reservedEnvironmentProblems([{ name: "OFFICE_ACTION_BRANCH" }], [RELEASE])).toEqual([]);
  });
});

describe("Leaves the workstation", () => {
  it("is marked on an Action a Proposal adds as a Workflow, or changes to one, whatever was given", () => {
    expect(markedAction(undefined, RELEASE).leavesTheWorkstation).toBe(true);
    expect(markedAction(PHONE, { ...RELEASE, key: "phone" }).leavesTheWorkstation).toBe(true);
    expect(markedAction(RELEASE, RELEASE).leavesTheWorkstation).toBe(false);
  });

  it("is kept as the user sent it, as the editor ticks it and the user may clear it", () => {
    const stored = [kept({ ...RELEASE, leavesTheWorkstation: true })];

    expect(editedActions([], [RELEASE])[0]?.leavesTheWorkstation).toBe(false);
    expect(
      editedActions([kept(PHONE)], [{ ...RELEASE, key: "phone" }])[0]?.leavesTheWorkstation,
    ).toBe(false);
    expect(editedActions(stored, [RELEASE])[0]?.leavesTheWorkstation).toBe(false);
    expect(
      editedActions([], [{ ...BUILD, leavesTheWorkstation: true }])[0]?.leavesTheWorkstation,
    ).toBe(true);
  });

  it("keeps a Workflow's file by its name, as Work › CI lists it", () => {
    const given = {
      ...RELEASE,
      settings: { ...RELEASE.settings, file: ".github/workflows/release.yml" },
    };

    expect(editedActions([], [given])[0]?.settings).toEqual(RELEASE.settings);
  });
});

describe("who set each value", () => {
  it("is the setter for each value changed, every one for an Action added, the earlier for the rest", () => {
    expect(setByAfter(undefined, BUILD, ANN)).toEqual({
      name: ANN,
      kind: ANN,
      settings: ANN,
      leavesTheWorkstation: ANN,
    });
    const before = kept(BUILD, { name: DANA, kind: DANA, settings: DANA });

    expect(setByAfter(before, { ...BUILD, name: "Build the web app" }, ANN)).toEqual({
      name: ANN,
      kind: DANA,
      settings: DANA,
    });
    expect(
      setByAfter(
        before,
        { ...BUILD, settings: { ...BUILD.settings, timeLimitMinutes: 30, projectDeviceId: null } },
        ANN,
      ),
    ).toEqual({ name: DANA, kind: DANA, settings: ANN });
  });
});

describe("a Proposal of Actions", () => {
  it("adds, changes and removes by key, a new Workflow marked, the user's values named on purpose", () => {
    const current = [kept(BUILD, { name: ANN }), kept(PHONE)];

    const proposed = proposedActions(current, {
      actions: [{ ...BUILD, name: "Build" }, RELEASE],
      removeActions: ["phone"],
      changeUserSet: ["build-web.name"],
    });

    expect(proposed.actions).toEqual([
      { key: "build-web", from: BUILD, to: { ...BUILD, name: "Build" }, userSet: ["name"] },
      { key: "release", from: null, to: { ...RELEASE, leavesTheWorkstation: true }, userSet: [] },
      { key: "phone", from: PHONE, to: null, userSet: [] },
    ]);
    expect(proposedActionsProblems(current, proposed, CONTEXT)).toEqual([]);
    expect(appliedActions(current, proposed, DANA)).toEqual([
      kept({ ...BUILD, name: "Build" }, { name: DANA }),
      kept(
        { ...RELEASE, leavesTheWorkstation: true },
        { name: DANA, kind: DANA, settings: DANA, leavesTheWorkstation: DANA },
      ),
    ]);
  });

  it("is refused changing a value the user set without naming it, or changing nothing", () => {
    const current = [kept(BUILD, { name: ANN })];

    expect(() => proposedActions(current, { actions: [{ ...BUILD, name: "Build" }] })).toThrowError(
      new ProjectRefused([
        "The user set build-web.name, which this changes: name each in changeUserSet to change it on purpose, or leave it as it is.",
      ]),
    );
    expect(() => proposedActions(current, { actions: [BUILD] })).toThrow(ProjectRefused);
  });

  it("may mark an Action Leaves the workstation, never clear the mark", () => {
    const current = [kept({ ...RELEASE, leavesTheWorkstation: true }), kept(BUILD)];

    const marking = proposedActions(current, {
      actions: [{ ...BUILD, leavesTheWorkstation: true }],
    });
    expect(proposedActionsProblems(current, marking, CONTEXT)).toEqual([]);

    const clearing = proposedActions(current, { actions: [RELEASE] });
    expect(proposedActionsProblems(current, clearing, CONTEXT)).toEqual([
      `Action "release": A Proposal may mark an Action Leaves the workstation, never clear the mark; only the user clears it.`,
    ]);
  });

  it("is refused once an Action it changes changed since it was drafted, and by the page's rules", () => {
    const current = [kept(BUILD)];
    const proposed: ProposedActions = proposedActions(current, {
      actions: [
        { ...BUILD, name: "Build" },
        { ...PHONE, settings: { targetKey: "ios" } },
      ],
    });

    expect(proposedActionsProblems([kept({ ...BUILD, name: "Other" })], proposed, CONTEXT)).toEqual(
      [`Action "build-web" changed since this was proposed.`],
    );
    expect(proposedActionsProblems(current, proposed, CONTEXT)).toEqual([
      `Action "phone": ios isn't one of «Shop»'s test targets.`,
    ]);
  });
});
