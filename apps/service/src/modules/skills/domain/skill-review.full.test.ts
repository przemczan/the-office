import { describe, expect, it } from "vitest";
import { aSkillFile } from "./skill.fixtures.js";
import { reviewOf } from "./skill-review.js";

const skillMd = (frontmatter: string, instructions = "Write them.") =>
  aSkillFile(
    "SKILL.md",
    `---\nname: notes\ndescription: Notes.\n${frontmatter}---\n${instructions}\n`,
  );

describe("reviewOf", () => {
  it("shows every file as text, in path order, and SKILL.md's instructions", () => {
    const review = reviewOf([aSkillFile("docs/a.md", "A."), skillMd("")]);

    expect(review).toEqual({
      files: [
        { path: "SKILL.md", text: expect.stringContaining("name: notes"), script: false },
        { path: "docs/a.md", text: "A.", script: false },
      ],
      instructions: "Write them.",
      warnings: [],
    });
  });

  it("shows a file that is no text without its text", () => {
    const image = { path: "logo.png", content: new Uint8Array([0x89, 0x50, 0xff, 0xfe]) };

    expect(reviewOf([skillMd(""), image]).files[1]).toEqual({
      path: "logo.png",
      text: undefined,
      script: false,
    });
  });

  it("flags scripts, by extension or by a #! line", () => {
    const review = reviewOf([
      skillMd(""),
      aSkillFile("scripts/collect.sh", "git log"),
      aSkillFile("bin/run", "#!/usr/bin/env node\n"),
    ]);

    expect(review.files.filter((file) => file.script).map((file) => file.path)).toEqual([
      "bin/run",
      "scripts/collect.sh",
    ]);
    expect(review.warnings).toEqual([
      "It includes 2 scripts. Scripts run with the permissions of whoever uses the skill.",
    ]);
  });

  it("warns of each frontmatter key that changes a session", () => {
    const review = reviewOf([
      skillMd(
        "hooks: {}\nmodel: opus\nallowed-tools: Bash\ncontext: fork\nwhen_to_use: Often.\ndisable-model-invocation: true\n",
      ),
    ]);

    expect(review.warnings).toEqual([
      "Its frontmatter sets hooks: commands the engine runs while the skill is in use, which The Office's rules never see.",
      "Its frontmatter changes the model while the skill is in use, which makes the session pay its whole prompt again.",
      "Its frontmatter changes which tools are allowed while the skill is in use; The Office's rules still decide each call.",
      "Its frontmatter runs the skill in a subagent.",
      "Its frontmatter adds when_to_use, which every session that has the skill lists besides its description.",
      "Its frontmatter keeps the model from using it: only the user runs it, as a skill command (/<name>).",
    ]);
  });

  it("passes the keys that only describe the skill, and disable-model-invocation turned off", () => {
    const review = reviewOf([
      skillMd(
        "license: MIT\nversion: 1.2.0\nargument-hint: <tag>\ndisable-model-invocation: false\n",
      ),
    ]);

    expect(review.warnings).toEqual([]);
  });

  it("names the keys it doesn't know", () => {
    expect(reviewOf([skillMd("colour: red\nicon: x\n")]).warnings).toEqual([
      "Its frontmatter has keys The Office doesn't know: colour, icon.",
    ]);
  });

  it("flags a description over 500 characters, which takes more of each session's listing", () => {
    const description = `|-\n  Use it for notes.\n  ${"x".repeat(490)}\n`;
    const files = [
      aSkillFile("SKILL.md", `---\nname: notes\ndescription: ${description}---\nWrite them.\n`),
    ];

    expect(reviewOf(files).warnings).toEqual([
      "Its description is 508 characters: every session that has it lists all of it, which leaves less of the listing's room for other skills.",
    ]);
  });

  it.each(["Run !`git status` first.", "```!\ngit status\n```"])(
    "warns of commands the text would run as it loads: %s",
    (instructions) => {
      expect(reviewOf([skillMd("", instructions)]).warnings).toEqual([
        "Its instructions hold commands meant to run as it loads; sessions don't run them.",
      ]);
    },
  );
});
