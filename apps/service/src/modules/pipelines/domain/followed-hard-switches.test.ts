import { describe, expect, it } from "vitest";
import { hardSwitchesSection, type FollowedHardSwitchValue } from "./followed-hard-switches.js";

const INSTALL = "install anything that changes the machine outside the worktree";
const NOT_AN_INSTALL =
  "Adding or updating the Project's own dependencies is a code change, not an install.";
const PUBLISH =
  "publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying";
const NOT_A_PUBLISH = "The Office publishes the Task's work itself once the Pipeline ends.";
const APPROVAL_IS_ONCE =
  "An approval is for that one call: Allow once lets you make it once, and Deny means you don't make it; go on without it, or end the Stage failed with the reason if you can't. Ask again for the next call.";

const ALLOWED: FollowedHardSwitchValue = { kind: "allowed" };
const NEVER: FollowedHardSwitchValue = { kind: "never" };

describe("hardSwitchesSection", () => {
  it("lets an Allowed switch's call be made without asking", () => {
    expect(hardSwitchesSection({ runInstalls: ALLOWED, publishOutsideThePipeline: ALLOWED })).toBe(
      `## Hard switches

- You may ${INSTALL} without asking. ${NOT_AN_INSTALL}
- You may ${PUBLISH} without asking. ${NOT_A_PUBLISH}`,
    );
  });

  it("sends a Consult switch's call to the consult tool first, naming the person", () => {
    expect(
      hardSwitchesSection({
        runInstalls: { kind: "consult", person: "Devops" },
        publishOutsideThePipeline: NEVER,
      }),
    ).toBe(
      `## Hard switches

- Before you ${INSTALL}, consult Devops first: ask approval of the call with consult, naming Devops, and make it only once the answer is Allow once. ${NOT_AN_INSTALL}
- You may not ${PUBLISH}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. ${NOT_A_PUBLISH}

${APPROVAL_IS_ONCE}`,
    );
  });

  it("sends an Ask me switch's call to the consult tool first, naming no person", () => {
    expect(
      hardSwitchesSection({ runInstalls: NEVER, publishOutsideThePipeline: { kind: "ask-me" } }),
    ).toBe(
      `## Hard switches

- You may not ${INSTALL}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. ${NOT_AN_INSTALL}
- Before you ${PUBLISH}, ask the user first: ask approval of the call with consult, naming no person, and make it only once the answer is Allow once. ${NOT_A_PUBLISH}

${APPROVAL_IS_ONCE}`,
    );
  });

  it("never offers an approval that lasts", () => {
    const words = hardSwitchesSection({
      runInstalls: { kind: "consult", person: "Devops" },
      publishOutsideThePipeline: { kind: "ask-me" },
    });

    expect(words.toLowerCase()).not.toContain("always");
  });
});
