import { Injectable } from "@nestjs/common";
import { repositorySkillsFrom, type RepositorySkill } from "../domain/repository-skills.js";
import { ProjectSkillFiles } from "../ports/project-skill-files.js";
import { SkillRepository } from "../ports/skill-repository.js";

/** The skills a repository holds of its own, which stay in it and are only read (spec §2.6). */
@Injectable()
export class RepositorySkills {
  constructor(
    private readonly files: ProjectSkillFiles,
    private readonly skills: SkillRepository,
  ) {}

  /** Those of the checkout at `folder`, such as a Project's own. */
  async of(folder: string): Promise<readonly RepositorySkill[]> {
    const [files, library] = await Promise.all([this.files.files(folder), this.skills.list()]);
    return repositorySkillsFrom(files, new Set(library.map((skill) => skill.name)));
  }
}
