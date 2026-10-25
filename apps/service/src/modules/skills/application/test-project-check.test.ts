import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineModule, EngineSessions } from "../../engine/index.js";
import { SkillsModule } from "../skills.module.js";
import { SessionSkills, type PreparedSkills } from "./session-skills.js";
import { SkillLibrary } from "./skill-library.js";

/**
 * Task 07's check on the Test Project (docs/tasks/07-skills.md): a skill written, reviewed, turned
 * on and given to everyone; a session in a worktree of the Test Project, with a Project skill of
 * its own, that lists exactly those two; the context the listing costs; and an edit that the next
 * session gets while the first keeps its version. Live sessions, so it runs only when asked:
 * OFFICE_ENGINE_TESTS=live and OFFICE_TEST_PROJECT=<the Test Project's folder>.
 */
const MODE = process.env["OFFICE_ENGINE_TESTS"];
const TEST_PROJECT = process.env["OFFICE_TEST_PROJECT"];
const run = promisify(execFile);

const PROJECT_SKILL = "admin-notes";
const BRIEF = "Reply with the single word: ready";

describe.runIf(MODE === "live" && TEST_PROJECT !== undefined)(
  "Task 07's check on the Test Project",
  () => {
    it("gives a session exactly its skill for everyone and the Project's, and keeps its version", async () => {
      const project = TEST_PROJECT ?? "";
      const folder = await mkdtemp(join(tmpdir(), "office-skills-check-"));
      const worktree = join(folder, "worktree");
      const git = (...args: string[]) => run("git", args, { cwd: project });
      await git("worktree", "add", "--detach", worktree, "HEAD");
      // Untracked in the worktree only: the Test Project itself is left as it is.
      await mkdir(join(worktree, ".claude", "skills", PROJECT_SKILL), { recursive: true });
      await writeFile(
        join(worktree, ".claude", "skills", PROJECT_SKILL, "SKILL.md"),
        `---\nname: ${PROJECT_SKILL}\ndescription: Notes on the admin panel's layout.\n---\nRead the README first.\n`,
      );
      const { app } = await startTestApplication({
        database: true,
        imports: [
          EventsModule,
          EventStreamModule,
          TelemetryModule,
          OfficeDataModule.forRoot(join(folder, "office-data")),
          SkillsModule,
          EngineModule,
        ],
      });
      const library = app.get(SkillLibrary);
      const skill = `release-notes-${randomUUID().slice(0, 8)}`;
      try {
        await library.write({
          name: skill,
          description: "Writes the release notes from the merged pull requests.",
          instructions: "Group them as Added, Changed and Fixed, one line each.",
        });
        const review = await library.review(skill);
        expect(review.files.map((file) => file.path)).toEqual(["SKILL.md"]);
        expect(review.warnings).toEqual([]);
        await library.turnOn(skill);
        await library.changeEveryone(skill, true);

        const first = await prepare(app, worktree);
        expect(first.expected).toEqual([PROJECT_SKILL, `office:${skill}`]);
        const withSkills = await firstTurnTokens(app, first, worktree);
        const without = await firstTurnTokens(app, undefined, worktree);
        console.info(
          `Task 07 check: the first call took ${withSkills} tokens with office:${skill} and ${PROJECT_SKILL}, ${without} without skills; the listing costs ${withSkills - without}.`,
        );
        expect(withSkills).toBeGreaterThan(without);

        await library.edit(skill, {
          description: "Writes the release notes from the merged pull requests.",
          instructions: "Group them as Added, Changed and Fixed, in the past tense.",
        });
        await library.turnOn(skill);
        const next = await prepare(app, worktree);
        expect(first.versions).toEqual([
          { name: skill, version: 1, filesHash: expect.any(String) },
        ]);
        expect(next.versions).toEqual([{ name: skill, version: 2, filesHash: expect.any(String) }]);
        console.info(
          `Task 07 check: the first session recorded ${skill} v1, the session after the edit v2.`,
        );
      } finally {
        // On and for everyone, it would reach every session prepared on the shared database.
        await library.remove(skill).catch(() => undefined);
        await app.close();
        await git("worktree", "remove", "--force", worktree);
        await rm(folder, { recursive: true, force: true });
      }
    }, 300_000);
  },
);

function prepare(app: INestApplication, worktree: string): Promise<PreparedSkills> {
  return app.get(SessionSkills).prepare({
    sessionId: randomUUID(),
    roleSkills: [],
    project: { folder: worktree, useProjectSkills: true },
  });
}

/** The tokens of a new session's first call, which the start check let start. */
async function firstTurnTokens(
  app: INestApplication,
  skills: PreparedSkills | undefined,
  worktree: string,
): Promise<number> {
  const session = await app.get(EngineSessions).start({
    id: randomUUID(),
    settings: {
      folder: worktree,
      environment: Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      model: "claude-haiku-5-5",
      effort: "low",
      skills: skills && {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      profile: { edit: false, run: { kind: "read-only-git" }, web: false },
      officeTools: [],
      outputSchema: undefined,
    },
    brief: { id: randomUUID(), text: BRIEF },
  });
  try {
    for await (const event of session.events) {
      if (event.kind === "turn-ended") {
        const { input, cacheRead, cacheCreation } = event.usage;
        return input + cacheRead + cacheCreation;
      }
    }
    throw new Error(`Session ${session.id} ended before its turn did.`);
  } finally {
    await session.end();
  }
}
