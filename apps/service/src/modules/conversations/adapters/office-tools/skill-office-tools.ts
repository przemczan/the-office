import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PROPOSE_SKILL_INSTALL_TOOL,
  PROPOSE_SKILL_TOOL,
  PROPOSE_SKILL_UPDATE_TOOL,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { SkillRefused, SkillSources, SkillUpdates } from "../../../skills/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import {
  LIST_SOURCE_SKILLS_TOOL,
  READ_SKILL_UPDATE_TOOL,
} from "../../domain/session-instructions.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with the source, the skill, its pinned version and its files; nothing is fetched until the user applies it, and it then arrives off until the user has reviewed it. Don't wait for it: tell the user what you propose and why, in a line or two.";

const UPDATE_DRAFTED =
  "The Proposal is in this Thread as a card, with the versions from and to, your notes and the files' diff; nothing is fetched until the user applies it, and the skill then stays on or off as it was. Don't wait for it: tell the user what changes and why it is worth it, in a line or two.";

const SKILL_DRAFTED =
  "The Proposal is in this Thread as a card, with the skill's name, description and instructions; nothing is added until the user applies it, and it then arrives off until the user has reviewed it. Don't wait for it: tell the user what the skill is for, in a line or two.";

const SKILL = z.string().describe("The installed skill's name, as the library lists it.");

const SOURCE = z
  .string()
  .describe("The source: owner/repo on GitHub, or a git URL (https://, ssh://, git@ or file://).");

/**
 * The Office tools skills are drafted with as Proposals (spec §2.6): anyone in a chat drafts a
 * written skill; Devops installs and updates skills from a Source, reading what a Source holds and
 * what an update changes, and drafting one Proposal per skill. The Office adds or fetches the skill
 * only when the user applies it, since chats only read (spec §6); each returns once it is drafted.
 */
@Injectable()
export class SkillOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly sources: SkillSources,
    private readonly updates: SkillUpdates,
    private readonly proposals: ProposalService,
  ) {}

  onModuleInit(): void {
    this.registerProposeSkill();
    this.registerListSourceSkills();
    this.registerProposeSkillInstall();
    this.registerReadSkillUpdate();
    this.registerProposeSkillUpdate();
  }

  private registerProposeSkill(): void {
    this.registry.register({
      name: PROPOSE_SKILL_TOOL,
      description:
        "Drafts a new skill for the library, written as its SKILL.md, as a Proposal the user applies with a click. It shows in this Thread as a card with the name, description and instructions; nothing is added until the user applies it, and the skill then arrives off until the user has reviewed it.",
      input: z.object({
        name: z
          .string()
          .describe(
            "The skill's name: lowercase letters and digits in words joined by dashes, such as release-notes.",
          ),
        description: z
          .string()
          .describe("When to use the skill, in one sentence; every session that has it lists it."),
        instructions: z
          .string()
          .describe("The skill's instructions, in Markdown: the body of its SKILL.md."),
      }),
      run: ({ name, description, instructions }, { sessionId }) =>
        refusedToTheAgent(async () => {
          await this.proposals.draft(sessionId, {
            kind: "skill",
            name: name.trim(),
            description: description.trim(),
            instructions,
          });
          return SKILL_DRAFTED;
        }),
    });
  }

  private registerReadSkillUpdate(): void {
    this.registry.register({
      name: READ_SKILL_UPDATE_TOOL,
      description:
        "Reads an installed skill's update: its pinned version, its source's newer one, and the unified diff of its files between them, as JSON. Read it before proposing the update, to write its notes.",
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

  private registerProposeSkillUpdate(): void {
    this.registry.register({
      name: PROPOSE_SKILL_UPDATE_TOOL,
      description:
        "Drafts updating an installed skill to its source's newest version as a Proposal the user applies with a click. It shows in this Thread as a card with the versions, your notes and the files' diff; applying it is the user's review, so the skill stays on or off as it was.",
      input: z.object({
        skill: SKILL,
        notes: z
          .string()
          .min(1)
          .describe(
            "What the update changes and what it means for whoever uses the skill, in a sentence or two.",
          ),
      }),
      run: ({ skill, notes }, { sessionId }) =>
        skillsRefusedToTheAgent(async () => {
          const draft = await this.updates.draft(skill.trim());
          return refusedToTheAgent(async () => {
            await this.proposals.draft(sessionId, {
              kind: "skill-update",
              name: draft.name,
              repository: draft.repository,
              folder: draft.folder,
              from: draft.from,
              to: draft.to,
              notes: notes.trim(),
              files: draft.files,
              filesHash: draft.filesHash,
            });
            return UPDATE_DRAFTED;
          });
        }),
    });
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
