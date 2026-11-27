import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { SkillRefused, SkillSources, SkillUpdates } from "../../../skills/index.js";
import {
  LIST_SOURCE_SKILLS_TOOL,
  READ_SKILL_UPDATE_TOOL,
} from "../../domain/session-instructions.js";

const SKILL = z.string().describe("The installed skill's name, as the library lists it.");

const SOURCE = z
  .string()
  .describe("The source: owner/repo on GitHub, or a git URL (https://, ssh://, git@ or file://).");

/**
 * The Office tools that read what a skill's change needs (spec §2.6): what a Source holds, for
 * `install_skill`, and what an update changes, for `update_skill`. The changes themselves are Office
 * actions (`write_skill`, `install_skill`, `update_skill`, ...), ruled by the person's Authority.
 */
@Injectable()
export class SkillOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly sources: SkillSources,
    private readonly updates: SkillUpdates,
  ) {}

  onModuleInit(): void {
    this.registerListSourceSkills();
    this.registerReadSkillUpdate();
  }

  private registerReadSkillUpdate(): void {
    this.registry.register({
      name: READ_SKILL_UPDATE_TOOL,
      area: CORE_AREA,
      description:
        "Reads an installed skill's update: its pinned version, its source's newer one, and the unified diff of its files between them, as JSON. Read it before update_skill, to write its notes.",
      input: z.object({ skill: SKILL }),
      run: ({ skill }) =>
        skillsRefusedToTheAgent(async () => {
          const draft = await this.updates.draft(skill.trim());
          const { diff, diffCut } = await this.updates.diff(draft.name, draft.from, draft.to);
          const read = { name: draft.name, repository: draft.repository, folder: draft.folder };
          return JSON.stringify(
            { ...read, from: draft.from, to: draft.to, files: draft.files, diff, diffCut },
            null,
            2,
          );
        }),
    });
  }

  private registerListSourceSkills(): void {
    this.registry.register({
      name: LIST_SOURCE_SKILLS_TOOL,
      area: CORE_AREA,
      description:
        "Lists the skills a source holds at the version it would be pinned at now (its newest tag, or its newest commit when it has no tags), as JSON: each skill's folder, name, description and files, or why it can't be installed. Install one with install_skill.",
      input: z.object({ source: SOURCE }),
      run: ({ source }) =>
        skillsRefusedToTheAgent(async () =>
          JSON.stringify(await this.sources.skills(source), null, 2),
        ),
    });
  }
}

function refusal(text: string): OfficeToolResult {
  return { text, isError: true };
}

/** Answers the Agent with what `read` gives, or with why Skills refused it. */
async function skillsRefusedToTheAgent(
  read: () => Promise<string | OfficeToolResult>,
): Promise<OfficeToolResult> {
  try {
    const result = await read();
    return typeof result === "string" ? { text: result, isError: false } : result;
  } catch (error) {
    if (error instanceof SkillRefused) return refusal(error.reasons.join(" "));
    throw error;
  }
}
