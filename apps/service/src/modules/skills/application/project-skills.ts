import { Injectable } from "@nestjs/common";
import { projectSkillsFrom, type ProjectSkill } from "../domain/project-skills.js";
import { ProjectSkillFiles } from "../ports/project-skill-files.js";
import { SkillRepository } from "../ports/skill-repository.js";
import { SkillUses } from "./skill-uses.js";

/** A Project skill as the Project page lists it, with its Skill uses there in the last 7 days. */
export type CountedProjectSkill = ProjectSkill & { readonly usesInLast7Days: number };

/** The skills a repository holds of its own, which stay in it and are only read (spec §2.6). */
@Injectable()
export class ProjectSkills {
  constructor(
    private readonly files: ProjectSkillFiles,
    private readonly skills: SkillRepository,
    private readonly uses: SkillUses,
  ) {}

  /**
   * Those of the Project's checkout at `folder`, each with its uses in the Project counted by its
   * key, so two that share a key, one skill to the engine, show the same count.
   */
  async of(projectId: string, folder: string): Promise<readonly CountedProjectSkill[]> {
    const [files, library, counts] = await Promise.all([
      this.files.files(folder),
      this.skills.list(),
      this.uses.projectCounts(projectId),
    ]);
    return projectSkillsFrom(files, new Set(library.map((skill) => skill.name))).map((skill) => ({
      ...skill,
      usesInLast7Days: counts.get(skill.key) ?? 0,
    }));
  }
}
