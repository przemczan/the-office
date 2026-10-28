import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PROPOSE_SKILL_INSTALL_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { SkillRefused, SkillSources } from "../../../skills/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { LIST_SOURCE_SKILLS_TOOL } from "../../domain/session-instructions.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with the source, the skill, its pinned version and its files; nothing is fetched until the user applies it, and it then arrives off until the user has reviewed it. Don't wait for it: tell the user what you propose and why, in a line or two.";

const SOURCE = z
  .string()
  .describe("The source: owner/repo on GitHub, or a git URL (https://, ssh://, git@ or file://).");

/**
 * The Office tools Devops installs skills from a Source with (spec §2.6): reading what a Source
 * holds, and drafting one Proposal per skill. The Office fetches the skill only when the user
 * applies it, since chats only read (spec §6); both return once the Source is read.
 */
@Injectable()
export class SkillOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly sources: SkillSources,
    private readonly proposals: ProposalService,
  ) {}

  onModuleInit(): void {
    this.registerListSourceSkills();
    this.registerProposeSkillInstall();
  }

  private registerListSourceSkills(): void {
    this.registry.register({
      name: LIST_SOURCE_SKILLS_TOOL,
      description:
        "Lists the skills a source holds at the version it would be pinned at now (its newest tag, or its newest commit when it has no tags), as JSON: each skill's folder, name, description and files, or why it can't be installed.",
      input: z.object({ source: SOURCE }),
      run: ({ source }) =>
        skillsRefusedToTheAgent(async () =>
          JSON.stringify(await this.sources.skills(source), null, 2),
        ),
    });
  }

  private registerProposeSkillInstall(): void {
    this.registry.register({
      name: PROPOSE_SKILL_INSTALL_TOOL,
      description:
        "Drafts installing one skill from a source as a Proposal the user applies with a click; draft one per skill. It shows in this Thread as a card, with the source, the skill, its pinned version and its files, and nothing is fetched into the library until the user applies it.",
      input: z.object({
        source: SOURCE,
        folder: z
          .string()
          .describe(
            "The skill's folder in the source, as list_source_skills gives it; empty for its top folder.",
          ),
      }),
      run: ({ source, folder }, { sessionId }) =>
        skillsRefusedToTheAgent(async () => {
          const read = await this.sources.skills(source, folder.trim());
          const [skill] = read.skills;
          if (!skill) {
            return refusal(
              `${read.repository} has no skill in "${folder}"; list_source_skills shows its folders.`,
            );
          }
          if ("problems" in skill) return refusal(skill.problems.join(" "));
          return refusedToTheAgent(async () => {
            await this.proposals.draft(sessionId, {
              kind: "skill-install",
              repository: read.repository,
              folder: skill.folder,
              pinnedVersion: read.pinnedVersion,
              name: skill.name,
              description: skill.description,
              files: skill.files,
              filesHash: skill.filesHash,
            });
            return DRAFTED;
          });
        }),
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
