import { Injectable } from "@nestjs/common";
import { projectSkillsFrom, type ProjectSkill } from "../domain/project-skills.js";
import { ProjectSkillFiles } from "../ports/project-skill-files.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** The skills a repository holds of its own, which stay in it and are only read (spec §2.6). */
@Injectable()
export class ProjectSkills {
  constructor(
    private readonly files: ProjectSkillFiles,
    private readonly skills: SkillRepository,
  ) {}

  /** Those of the checkout at `folder`, such as a Project's own. */
  async of(folder: string): Promise<readonly ProjectSkill[]> {
    const [files, library] = await Promise.all([this.files.files(folder), this.skills.list()]);
    return projectSkillsFrom(files, new Set(library.map((skill) => skill.name)));
  }
}
