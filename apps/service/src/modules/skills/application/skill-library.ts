import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { skillNameTaken, type Skill } from "../domain/skill.js";
import {
  addSkill,
  changeEveryone,
  removeSkill,
  saveVersion,
  turnOff,
  turnOn,
  type SkillChange,
} from "../domain/skill-changes.js";
import {
  checkSameSkill,
  writtenDraft,
  writtenSkillProblems,
  type SkillDraft,
  type WrittenSkill,
} from "../domain/skill-draft.js";
import { SkillNotFound } from "../domain/skill-not-found.js";
import { SkillRefused } from "../domain/skill-refused.js";
import { reviewOf, type SkillReview } from "../domain/skill-review.js";
import {
  draftFromMd,
  draftFromZip,
  uploadKind,
  uploadKindProblem,
} from "../domain/skill-upload.js";
import { LibraryFolder } from "../ports/library-folder.js";
import { SkillRepository } from "../ports/skill-repository.js";
import { ZipReader } from "../ports/zip-reader.js";
import { SkillSources, type SkillInstall } from "./skill-sources.js";

/** An uploaded file, as the user picked it. */
export interface Upload {
  readonly fileName: string;
  readonly content: Uint8Array;
}

/** What Review shows of a skill: the skill, and what its files hold. */
export interface ReviewedSkill extends SkillReview {
  readonly skill: Skill;
}

/**
 * The skill library's use cases (spec §2.6). Every new version arrives waiting for review. Each
 * change is saved first and its event published after, so nothing hears of a change that
 * wasn't kept.
 */
@Injectable()
export class SkillLibrary {
  constructor(
    private readonly repository: SkillRepository,
    private readonly folder: LibraryFolder,
    private readonly zips: ZipReader,
    private readonly sources: SkillSources,
    private readonly events: EventBus,
  ) {}

  async list(): Promise<readonly Skill[]> {
    return this.repository.list();
  }

  async read(name: string): Promise<Skill> {
    const skill = await this.repository.find(name);
    if (!skill) throw new SkillNotFound(name);
    return skill;
  }

  async review(name: string): Promise<ReviewedSkill> {
    const skill = await this.read(name);
    const files = await this.folder.read(skill.name, skill.filesHash);
    return { skill, ...reviewOf(files) };
  }

  /** Refuses with every reason, before keeping anything, when it breaks a rule. */
  async write(written: WrittenSkill): Promise<Skill> {
    return this.add(writtenDraft(written));
  }

  /** Why `write` would refuse `written` now, every reason, keeping nothing. */
  async writeProblems(written: WrittenSkill): Promise<readonly string[]> {
    const problems = writtenSkillProblems(written);
    return problems.length > 0 ? problems : this.nameTakenProblems(written.name.trim());
  }

  async upload(upload: Upload): Promise<Skill> {
    return this.add(await this.draftOf(upload));
  }

  /**
   * Fetches the skill in the Source's folder at its pinned version, as uploaded files are added.
   * Refuses when the Source can't be read or its files no longer have the expected hash.
   */
  async install(install: SkillInstall): Promise<Skill> {
    return this.add(await this.sources.draft(install));
  }

  /** Why a skill can't be installed under `name` now, which needs no Source read. */
  async installProblems(name: string): Promise<readonly string[]> {
    return this.nameTakenProblems(name);
  }

  /** The next version of a written skill, from the Write form. */
  async edit(name: string, written: Omit<WrittenSkill, "name">): Promise<Skill> {
    const skill = await this.read(name);
    if (skill.source !== "written") throw new SkillRefused([notEditable(skill)]);
    return this.saveVersion(name, writtenDraft({ ...written, name }));
  }

  /** The next version of an uploaded skill. */
  async uploadVersion(name: string, upload: Upload): Promise<Skill> {
    const skill = await this.read(name);
    if (skill.source !== "uploaded-file" && skill.source !== "uploaded-folder") {
      throw new SkillRefused([notEditable(skill)]);
    }
    const draft = await this.draftOf(upload);
    checkSameSkill(draft, name);
    return this.saveVersion(name, draft);
  }

  async turnOn(name: string): Promise<Skill> {
    return this.update(name, turnOn);
  }

  async turnOff(name: string): Promise<Skill> {
    return this.update(name, turnOff);
  }

  async changeEveryone(name: string, everyone: boolean): Promise<Skill> {
    return this.update(name, (skill) => changeEveryone(skill, everyone));
  }

  /** Its files stay in the library while a session that got them can be resumed. */
  async remove(name: string): Promise<void> {
    const skill = await this.repository.remove(name);
    await this.events.publish(removeSkill(skill));
  }

  private async nameTakenProblems(name: string): Promise<readonly string[]> {
    return (await this.repository.find(name)) ? [skillNameTaken(name)] : [];
  }

  private async draftOf({ fileName, content }: Upload): Promise<SkillDraft> {
    const kind = uploadKind(fileName);
    if (kind === "md") return draftFromMd(fileName, content);
    if (kind === "zip") return draftFromZip(fileName, await this.zips.entries(content));
    throw new SkillRefused([uploadKindProblem()]);
  }

  private async add(draft: SkillDraft): Promise<Skill> {
    if (await this.repository.find(draft.skill.name)) {
      throw new SkillRefused([skillNameTaken(draft.skill.name)]);
    }
    const filesHash = await this.folder.keep(draft.skill.name, draft.files);
    const { skill, event } = addSkill(draft.skill, filesHash, new Date());
    await this.repository.add(skill);
    await this.events.publish(event);
    return skill;
  }

  private async saveVersion(name: string, draft: SkillDraft): Promise<Skill> {
    const filesHash = await this.folder.keep(name, draft.files);
    return this.update(name, (skill) =>
      saveVersion(skill, draft.skill.description, filesHash, new Date()),
    );
  }

  private async update<Event extends DomainEvent>(
    name: string,
    change: (skill: Skill) => SkillChange<Event> | undefined,
  ): Promise<Skill> {
    const { skill, event } = await this.repository.update(name, change);
    if (event) await this.events.publish(event);
    return skill;
  }
}

/** Why a skill's next version can't come the way it was asked for. */
function notEditable(skill: Skill): string {
  switch (skill.source) {
    case "written":
      return `${skill.name} was written in The Office; edit it instead.`;
    case "installed":
      return `${skill.name} was installed from ${skill.installedFrom?.repository ?? "a source"}; it changes by an update Proposal.`;
    case "uploaded-file":
    case "uploaded-folder":
      return `${skill.name} was uploaded; upload a new version of it instead.`;
  }
}
