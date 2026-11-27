import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CHANGE_SKILL_EVERYONE_ACTION,
  CHANGE_SKILL_ROLES_ACTION,
  CHANGE_SKILL_STATE_ACTION,
  DELETE_SKILL_ACTION,
  EDIT_SKILL_ACTION,
  INSTALL_SKILL_ACTION,
  SKILLS_OFFICE_ACTIONS,
  UPDATE_SKILL_ACTION,
  WRITE_SKILL_ACTION,
  type OfficeAction,
  type Skill as SkillResponse,
} from "@the-office/contracts";
import type { z } from "zod";
import type { SignedInUser } from "../../../../platform/http/signed-in-requests.js";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolChangedField,
  type OfficeToolDraft,
  type OfficeToolResult,
  type OfficeToolUser,
} from "../../../engine/index.js";
import { RoleSkills } from "../../application/role-skills.js";
import { SessionPeople } from "../../application/session-people.js";
import { SkillLibrary } from "../../application/skill-library.js";
import { SkillSources } from "../../application/skill-sources.js";
import { SkillUpdates } from "../../application/skill-updates.js";
import { SkillUses } from "../../application/skill-uses.js";
import { pinnedVersionLabel } from "../../domain/installed-source.js";
import type { Skill } from "../../domain/skill.js";
import { SkillNotFound } from "../../domain/skill-not-found.js";
import { SkillRefused } from "../../domain/skill-refused.js";
import type { UserRef } from "../../domain/user.js";
import { skillResponseOf } from "../http/skill-responses.js";

/**
 * Who asks an action of the library: the user behind the request, the call or the Proposal's
 * applying. Refused when nobody is, for an action that records who made the change.
 */
interface Caller {
  user(): Promise<UserRef>;
}

/** What a handler gives back: the skill, and for the Roles action the Roles it now has. */
interface Handled {
  readonly skill?: Skill;
  readonly roles?: readonly string[];
}

/**
 * One of the library's Office actions as Skills carries it out: `handle` for the user's request and
 * the Agent's call alike, its result answered to the web by `response` and worded to the Agent by
 * `words`.
 */
interface SkillActionHandler<Action extends OfficeAction> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, caller: Caller): Promise<Handled>;
  words(result: Handled, input: z.output<Action["input"]>): string;
}

type AnySkillActionHandler = SkillActionHandler<OfficeAction>;

function handler<Action extends OfficeAction>(
  each: SkillActionHandler<Action>,
): AnySkillActionHandler {
  return each as unknown as AnySkillActionHandler;
}

/**
 * The skill library's Office actions (the Office action convention): the one handler of each action
 * Skills declares, which its route (`SkillOfficeActionsController`) and its Office tool, registered
 * here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class SkillOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnySkillActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly library: SkillLibrary,
    private readonly sources: SkillSources,
    private readonly updates: SkillUpdates,
    private readonly roleSkills: RoleSkills,
    private readonly uses: SkillUses,
    private readonly sessionPeople: SessionPeople,
  ) {
    this.handlers = new Map(
      [
        this.writeSkill(),
        this.editSkill(),
        this.installSkill(),
        this.updateSkill(),
        this.changeSkillState(),
        this.changeSkillEveryone(),
        this.changeSkillRoles(),
        this.deleteSkill(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = SKILLS_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      this.registry.register(
        officeActionTool(
          each.action,
          (input, { sessionId, allowedBy }) =>
            answered(async () => {
              const user = () => this.userInSession(sessionId, allowedBy);
              return each.words(await each.handle(input, { user }), input);
            }),
          {
            draft: (input) => this.draftOf(each.action, input as Record<string, unknown>),
            applyFor: (input, { user }) =>
              answered(async () =>
                each.words(await each.handle(input, { user: () => Promise.resolve(user) }), input),
              ),
          },
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, signedIn: SignedInUser): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Skills carries out no Office action ${action.name}.`);
    const result = await each.handle(input as never, { user: () => Promise.resolve(signedIn) });
    if (action.name === DELETE_SKILL_ACTION.name) return undefined;
    return this.respond(result);
  }

  private respond({ skill, roles }: Handled): Promise<SkillResponse> {
    if (!skill) throw new Error("The action kept no skill to answer with.");
    return skillResponseOf(skill, this.roleSkills, this.uses, roles);
  }

  /** The user behind a session's call: who asked the person, else who allowed the call. */
  private async userInSession(
    sessionId: string,
    allowedBy: OfficeToolUser | undefined,
  ): Promise<UserRef> {
    const askedBy = await this.sessionPeople.askedByInSession(sessionId);
    const user = askedBy ?? allowedBy;
    if (!user) {
      throw new SkillRefused([
        "This change records the user who made it, and no user is behind this call: ask the user to ask for it in this Thread.",
      ]);
    }
    return { userId: user.userId, name: user.name };
  }

  private writeSkill(): AnySkillActionHandler {
    return handler({
      action: WRITE_SKILL_ACTION,
      handle: async (written) => ({ skill: await this.library.write(written) }),
      words: ({ skill }) =>
        `The skill ${skill?.name ?? ""} is in the library, waiting for the user's review before it is on.`,
    });
  }

  private editSkill(): AnySkillActionHandler {
    return handler({
      action: EDIT_SKILL_ACTION,
      handle: async ({ name, ...edit }) => ({ skill: await this.library.edit(name, edit) }),
      words: ({ skill }) =>
        `The skill ${skill?.name ?? ""} has a new version ${skill?.version ?? ""}, waiting for review.`,
    });
  }

  /** Reads the Source now and installs at the version it is pinned at, as the Proposal did. */
  private installSkill(): AnySkillActionHandler {
    return handler({
      action: INSTALL_SKILL_ACTION,
      handle: async ({ source, folder }) => {
        const read = await this.readSourceSkill(source, folder);
        const skill = await this.library.install({
          repository: read.repository,
          folder: read.skill.folder,
          pinnedVersion: read.pinnedVersion,
          filesHash: read.skill.filesHash,
        });
        return { skill };
      },
      words: ({ skill }) =>
        `The skill ${skill?.name ?? ""} is installed from its source, off until the user has reviewed it.`,
    });
  }

  private updateSkill(): AnySkillActionHandler {
    return handler({
      action: UPDATE_SKILL_ACTION,
      handle: async ({ name }) => {
        const update = await this.updates.draft(name.trim());
        const skill = await this.updates.apply({
          name: update.name,
          from: update.from,
          to: update.to,
          filesHash: update.filesHash,
        });
        return { skill };
      },
      words: ({ skill }) =>
        `The skill ${skill?.name ?? ""} is updated to ${skill?.installedFrom ? pinnedVersionLabel(skill.installedFrom.pinnedVersion) : "its source's newest version"}; it stays ${skill?.state === "on" ? "on" : "as it was"}.`,
    });
  }

  private changeSkillState(): AnySkillActionHandler {
    return handler({
      action: CHANGE_SKILL_STATE_ACTION,
      handle: async ({ name, state }) => ({
        skill: state === "on" ? await this.library.turnOn(name) : await this.library.turnOff(name),
      }),
      words: ({ skill }) => `The skill ${skill?.name ?? ""} is ${skill?.state ?? ""} now.`,
    });
  }

  private changeSkillEveryone(): AnySkillActionHandler {
    return handler({
      action: CHANGE_SKILL_EVERYONE_ACTION,
      handle: async ({ name, everyone }) => ({
        skill: await this.library.changeEveryone(name, everyone),
      }),
      words: ({ skill }) =>
        `The skill ${skill?.name ?? ""} ${skill?.everyone ? "comes" : "no longer comes"} with every Role now.`,
    });
  }

  private changeSkillRoles(): AnySkillActionHandler {
    return handler({
      action: CHANGE_SKILL_ROLES_ACTION,
      handle: async ({ name, roles }, caller) => {
        const assigned = await this.roleSkills.assignSkill(name, roles, await caller.user());
        return { skill: await this.library.read(name), roles: assigned };
      },
      words: ({ skill, roles }) =>
        `The skill ${skill?.name ?? ""} is assigned to ${roles && roles.length > 0 ? roles.join(", ") : "no Role"} now.`,
    });
  }

  private deleteSkill(): AnySkillActionHandler {
    return handler({
      action: DELETE_SKILL_ACTION,
      handle: async ({ name }) => {
        await this.library.remove(name);
        return {};
      },
      words: (_, { name }) => `The skill ${name} is removed from the library.`,
    });
  }

  /** The one skill a Source holds in the folder, or why it can't be installed. */
  private async readSourceSkill(source: string, folder: string) {
    const read = await this.sources.skills(source, folder.trim());
    const [skill] = read.skills;
    if (!skill) {
      throw new SkillRefused([
        `${read.repository} has no skill in "${folder}"; list_source_skills shows its folders.`,
      ]);
    }
    if ("problems" in skill) throw new SkillRefused(skill.problems);
    return { repository: read.repository, pinnedVersion: read.pinnedVersion, skill };
  }

  /** What a call changes now: the skill it acts on, or the Source's skill it installs. */
  private async draftOf(
    action: OfficeAction,
    input: Record<string, unknown>,
  ): Promise<OfficeToolDraft> {
    if (action.name === INSTALL_SKILL_ACTION.name) {
      return this.installDraft(input as z.output<typeof INSTALL_SKILL_ACTION.input>);
    }
    if (action.name === UPDATE_SKILL_ACTION.name) {
      return this.updateDraft(input as z.output<typeof UPDATE_SKILL_ACTION.input>);
    }
    const subject = action.subject(input);
    const skill = await this.find(subject.id);
    if (action.name === WRITE_SKILL_ACTION.name) {
      // A name taken since is a change to what the call decides by.
      return officeActionDraft(action as typeof WRITE_SKILL_ACTION, input as never, {
        title: subject.id,
        decidedBy: { taken: skill !== undefined },
        values: {},
      });
    }
    if (!skill) {
      return officeActionDraft(action, input as never, {
        title: subject.id,
        decidedBy: { exists: false },
        values: {},
      });
    }
    return officeActionDraft(action, input as never, {
      title: skill.name,
      // The version and its files are what turning on, editing or deleting acts on.
      decidedBy: { version: skill.version, filesHash: skill.filesHash, source: skill.source },
      values: await this.valuesOf(action, skill),
    });
  }

  private async find(name: string): Promise<Skill | undefined> {
    try {
      return await this.library.read(name);
    } catch (error) {
      if (error instanceof SkillNotFound) return undefined;
      throw error;
    }
  }

  /** The value of each field an action writes, as it stands now, by the action's input name. */
  private async valuesOf(action: OfficeAction, skill: Skill): Promise<Record<string, unknown>> {
    switch (action.name) {
      case EDIT_SKILL_ACTION.name: {
        const { instructions } = await this.library.review(skill.name);
        return { description: skill.description, instructions };
      }
      case CHANGE_SKILL_STATE_ACTION.name:
        return { state: skill.state };
      case CHANGE_SKILL_EVERYONE_ACTION.name:
        return { everyone: skill.everyone };
      case CHANGE_SKILL_ROLES_ACTION.name:
        return { roles: ((await this.roleSkills.bySkill()).get(skill.name) ?? []).toSorted() };
      default:
        return {};
    }
  }

  /**
   * The skill a Source holds now, with its pinned version and files: what is written. A Source that
   * can't be read drafts as it is, its reasons in the fingerprint, and applying refuses with them.
   */
  private async installDraft(
    input: z.output<typeof INSTALL_SKILL_ACTION.input>,
  ): Promise<OfficeToolDraft> {
    try {
      const { repository, pinnedVersion, skill } = await this.readSourceSkill(
        input.source,
        input.folder,
      );
      const taken = (await this.find(skill.name)) !== undefined;
      const drafted = officeActionDraft(INSTALL_SKILL_ACTION, input, {
        title: skill.name,
        decidedBy: {
          repository,
          folder: skill.folder,
          pinnedVersion,
          filesHash: skill.filesHash,
          taken,
        },
        values: {},
      });
      return {
        ...drafted,
        fields: [
          ...drafted.fields,
          field("Name", null, skill.name),
          field("Description", null, skill.description),
          field("Pinned version", null, pinnedVersionLabel(pinnedVersion)),
          field("Files", null, skill.files.join("\n")),
        ],
      };
    } catch (error) {
      if (!(error instanceof SkillRefused)) throw error;
      return officeActionDraft(INSTALL_SKILL_ACTION, input, {
        title: input.source.trim(),
        decidedBy: { problems: error.reasons },
        values: {},
      });
    }
  }

  /** The update from the pinned version to the Source's newer one, with the diff of its files. */
  private async updateDraft(
    input: z.output<typeof UPDATE_SKILL_ACTION.input>,
  ): Promise<OfficeToolDraft> {
    const name = input.name.trim();
    try {
      const update = await this.updates.draft(name);
      const drafted = officeActionDraft(UPDATE_SKILL_ACTION, input, {
        title: name,
        decidedBy: { from: update.from, to: update.to, filesHash: update.filesHash },
        values: {},
      });
      const diff = await this.updates.diff(name, update.from, update.to).catch((error: unknown) => {
        if (error instanceof SkillRefused) return undefined;
        throw error;
      });
      return {
        ...drafted,
        fields: [
          ...drafted.fields,
          field("Version", pinnedVersionLabel(update.from), pinnedVersionLabel(update.to)),
          field("Description", null, update.description),
          field("Files", null, update.files.join("\n")),
          ...(diff ? [field("Changes", null, diff.diff || "No file changes.")] : []),
        ],
      };
    } catch (error) {
      if (!(error instanceof SkillRefused || error instanceof SkillNotFound)) throw error;
      const reasons = error instanceof SkillRefused ? error.reasons : [error.message];
      return officeActionDraft(UPDATE_SKILL_ACTION, input, {
        title: name,
        decidedBy: { problems: reasons },
        values: {},
      });
    }
  }
}

function field(label: string, before: string | null, after: string): OfficeToolChangedField {
  const long = after.includes("\n") || after.length > 80;
  return { label, before, after, form: long ? "long" : "short" };
}

/** The library's refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof SkillRefused) return { text: error.message, isError: true };
    if (error instanceof SkillNotFound) return { text: error.message, isError: true };
    throw error;
  }
}
