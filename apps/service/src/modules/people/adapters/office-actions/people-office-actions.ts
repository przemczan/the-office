import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CHANGE_ROLE_CARD_ACTION,
  DELETE_MEMORY_NOTE_ACTION,
  HIRE_BACK_ROLE_ACTION,
  HIRE_ROLE_ACTION,
  LET_GO_ROLE_ACTION,
  PEOPLE_OFFICE_ACTIONS,
  REMOVE_AVATAR_ACTION,
  SET_AVATAR_FROM_ATTACHMENT_ACTION,
  type OfficeAction,
  type RoleCard,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  canonicalJson,
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolChangedField,
  type OfficeToolDraft,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { AvatarSources } from "../../application/avatar-sources.js";
import { Duties } from "../../application/duties.js";
import { MemoryService } from "../../application/memory-service.js";
import { PersonAvatars } from "../../application/person-avatars.js";
import { RoleService, type RoleWithAssignments } from "../../application/role-service.js";
import { SessionPeople } from "../../application/session-people.js";
import { AvatarNotFound } from "../../domain/avatar.js";
import { MemoryNoteNotFound } from "../../domain/memory-note-not-found.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { RoleRefused } from "../../domain/role-refused.js";
import type { UserRef } from "../../domain/user.js";
import { roleResponseContext, toRoleResponse } from "../http/role-responses.js";

/**
 * Who a call of an action is carried out for: the signed-in user, or the user who applied a
 * Proposal of it with the person who proposed it, or a person calling it on their own, with the
 * user whose Allow once let it run.
 */
export type PeopleCaller =
  | { readonly kind: "user"; readonly user: UserRef; readonly proposedBy?: string }
  | { readonly kind: "person"; readonly roleKey: string; readonly allowedBy?: UserRef };

/** What an action carried out for the web or an Agent: a Role as it is now, or a deleted note. */
type Result = RoleWithAssignments | { readonly key: string; readonly noteId: string };

/**
 * One of People's Office actions as People carries it out: `handle` for the user's request, an
 * Agent's call and a Proposal applied alike, its result answered to the web by `response` and
 * worded to the Agent by `words`.
 */
interface PeopleActionHandler<Action extends OfficeAction, Outcome> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: PeopleCaller): Promise<Outcome>;
  response(outcome: Outcome): Promise<z.input<Action["answer"]>>;
  words(outcome: Outcome): string;
}

type AnyPeopleActionHandler = PeopleActionHandler<OfficeAction, Result>;

function handler<Action extends OfficeAction, Outcome extends Result>(
  each: PeopleActionHandler<Action, Outcome>,
): AnyPeopleActionHandler {
  return each as unknown as AnyPeopleActionHandler;
}

/** The actions only a person's own Memory and Avatar are acted on by a person. */
const OWN_ONLY: ReadonlySet<string> = new Set([
  DELETE_MEMORY_NOTE_ACTION.name,
  SET_AVATAR_FROM_ATTACHMENT_ACTION.name,
  REMOVE_AVATAR_ACTION.name,
]);

/**
 * People's Office actions (the Office action convention): the one handler of each action People
 * declares, which its route (`PeopleOfficeActionsController`) and its Office tool, registered here,
 * both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class PeopleOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyPeopleActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly roles: RoleService,
    private readonly duties: Duties,
    private readonly memory: MemoryService,
    private readonly avatars: PersonAvatars,
    private readonly avatarSources: AvatarSources,
    private readonly sessionPeople: SessionPeople,
  ) {
    this.handlers = new Map(
      [
        this.hireRole(),
        this.changeRoleCard(),
        this.letGoRole(),
        this.hireBackRole(),
        this.deleteMemoryNote(),
        this.setAvatarFromAttachment(),
        this.removeAvatar(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = PEOPLE_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const tool = officeActionTool(
        each.action,
        (input, { sessionId, allowedBy }) =>
          answered(async () => {
            const roleKey = await this.sessionPeople.personInSession(sessionId);
            if (roleKey === undefined) {
              throw new RoleRefused(["The Office doesn't know whose session this is."]);
            }
            return each.words(
              await each.handle(input, {
                kind: "person",
                roleKey,
                ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
              }),
            );
          }),
        {
          draft: (input) => this.draft(each.action, input),
          applyFor: (input, { user, proposedBy }) =>
            answered(async () =>
              each.words(
                await each.handle(input, {
                  kind: "user",
                  user: { userId: user.userId, name: user.name },
                  proposedBy,
                }),
              ),
            ),
        },
      );
      this.registry.register(
        OWN_ONLY.has(each.action.name) && tool.authority
          ? {
              ...tool,
              authority: {
                ...tool.authority,
                // Refused up front, so nobody is asked to approve or apply what is never allowed.
                check: async (input, call) => {
                  const roleKey = await this.sessionPeople.personInSession(call.sessionId);
                  const { key } = input as { key: string };
                  return roleKey !== undefined && roleKey !== key
                    ? ownOnlyWords(roleKey)
                    : undefined;
                },
              },
            }
          : tool,
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, user: UserRef): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`People carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, { kind: "user", user }));
  }

  private async roleResponse(outcome: RoleWithAssignments): Promise<never> {
    return toRoleResponse(outcome, await roleResponseContext(this.roles, this.duties)) as never;
  }

  private hireRole(): AnyPeopleActionHandler {
    return handler({
      action: HIRE_ROLE_ACTION,
      handle: ({ roleKey, name, card }, by) => {
        const savedBy = by.kind === "user" ? by.user : (by.allowedBy ?? null);
        const proposedBy = by.kind === "user" ? by.proposedBy : by.roleKey;
        return card
          ? this.roles.hireFromScratch(...cardAndSkills(card), savedBy, proposedBy)
          : this.roles.hire(roleKey ?? "", name ?? "", savedBy, proposedBy);
      },
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) =>
        `${role.card.name} is hired into the Role ${role.key}.`,
    });
  }

  private changeRoleCard(): AnyPeopleActionHandler {
    return handler({
      action: CHANGE_ROLE_CARD_ACTION,
      handle: ({ key, ...card }, by) =>
        this.roles.changeCard(
          key,
          ...cardAndSkills(card as RoleCard),
          by.kind === "user" ? by.user : (by.allowedBy ?? null),
          by.kind === "user" ? by.proposedBy : by.roleKey,
        ),
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) =>
        `${role.card.name}'s card is saved as version ${role.cardVersion}; sessions started from now on read it.`,
    });
  }

  private letGoRole(): AnyPeopleActionHandler {
    return handler({
      action: LET_GO_ROLE_ACTION,
      handle: ({ key }) => this.roles.letGo(key),
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) =>
        `${role.card.name} is let go: nobody fills the Role ${role.key} from now on.`,
    });
  }

  private hireBackRole(): AnyPeopleActionHandler {
    return handler({
      action: HIRE_BACK_ROLE_ACTION,
      handle: ({ key }) => this.roles.hireBack(key),
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) =>
        `${role.card.name} is hired back into the Role ${role.key}.`,
    });
  }

  private deleteMemoryNote(): AnyPeopleActionHandler {
    return handler({
      action: DELETE_MEMORY_NOTE_ACTION,
      handle: async ({ key, noteId }, by) => {
        ownOnly(by, key);
        await this.memory.remove(key, noteId);
        return { key, noteId };
      },
      response: async (deleted: { key: string; noteId: string }) => deleted,
      words: () => "The Memory note is deleted.",
    });
  }

  private setAvatarFromAttachment(): AnyPeopleActionHandler {
    return handler({
      action: SET_AVATAR_FROM_ATTACHMENT_ACTION,
      handle: async ({ key, attachmentId }, by) => {
        ownOnly(by, key);
        await this.roles.read(key);
        await this.avatars.change(key, await this.avatarSources.contentOf(attachmentId));
        return this.roles.read(key);
      },
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) => `${role.card.name}'s Avatar is the image given.`,
    });
  }

  private removeAvatar(): AnyPeopleActionHandler {
    return handler({
      action: REMOVE_AVATAR_ACTION,
      handle: async ({ key }, by) => {
        ownOnly(by, key);
        await this.avatars.remove(key);
        return this.roles.read(key);
      },
      response: (role: RoleWithAssignments) => this.roleResponse(role),
      words: ({ role }: RoleWithAssignments) =>
        `${role.card.name}'s Avatar is removed: their initials show.`,
    });
  }

  /**
   * What a call of `action` with `input` changes, read now. The fingerprint covers the card's
   * version, the note or the Avatar the call acts on, so a change to it since the draft is a change
   * to the subject.
   */
  private async draft(action: OfficeAction, input: unknown): Promise<OfficeToolDraft> {
    const given = input as Record<string, unknown>;
    const key = action.subject(input as never).id;
    const found = await this.find(key);
    switch (action.name) {
      case HIRE_ROLE_ACTION.name: {
        const { card, ...rest } = given as { card?: RoleCard };
        return officeActionDraft(
          action,
          { ...rest, ...card, card: undefined, roleKey: key } as never,
          {
            title: card?.name ?? String(given["name"]),
            decidedBy: { filledBy: found && (found.role.letGoAt?.toISOString() ?? "hired") },
            values: {},
          },
        );
      }
      case CHANGE_ROLE_CARD_ACTION.name: {
        if (!found) throw new RoleNotFound(key);
        const current = toRoleResponse(found, await roleResponseContext(this.roles, this.duties));
        const now = current.card as unknown as Record<string, unknown>;
        // Hard switches are ignored when the card gives its Authority; what is the same isn't listed.
        const changed = Object.fromEntries(
          Object.entries(given).filter(
            ([field, value]) =>
              !(field === "hardSwitches" && given["authority"] !== undefined) &&
              canonicalJson(value) !== canonicalJson(now[field]),
          ),
        );
        return officeActionDraft(action, { key, ...changed } as never, {
          title: found.role.card.name,
          decidedBy: { cardVersion: found.role.cardVersion },
          values: now,
        });
      }
      case DELETE_MEMORY_NOTE_ACTION.name: {
        if (!found) throw new RoleNotFound(key);
        const { noteId } = given as { noteId: string };
        const note = (await this.memory.read(key)).notes.find(({ id }) => id === noteId);
        if (!note) throw new MemoryNoteNotFound(noteId);
        return this.withFields(action, input, found, { note: note.text }, [
          { label: "Memory note", before: note.text, after: null, form: "long" },
        ]);
      }
      case SET_AVATAR_FROM_ATTACHMENT_ACTION.name:
      case REMOVE_AVATAR_ACTION.name: {
        if (!found) throw new RoleNotFound(key);
        const { attachmentId } = given as { attachmentId?: string };
        return this.withFields(
          action,
          input,
          found,
          { avatar: found.role.avatar?.id ?? null, attachmentId },
          [
            {
              label: "Avatar",
              before: found.role.avatar ? "a picture" : "their initials",
              after: attachmentId ? "the image Attachment" : "their initials",
              form: "short",
            },
          ],
        );
      }
      default: {
        if (!found) throw new RoleNotFound(key);
        return officeActionDraft(action, input as never, {
          title: found.role.card.name,
          decidedBy: { letGoAt: found.role.letGoAt?.toISOString() ?? null },
          values: {},
        });
      }
    }
  }

  private withFields(
    action: OfficeAction,
    input: unknown,
    found: RoleWithAssignments,
    decidedBy: Record<string, unknown>,
    fields: readonly OfficeToolChangedField[],
  ): OfficeToolDraft {
    const draft = officeActionDraft(action, input as never, {
      title: found.role.card.name,
      decidedBy,
      values: {},
    });
    return { ...draft, fields };
  }

  private async find(key: string): Promise<RoleWithAssignments | undefined> {
    try {
      return await this.roles.read(key);
    } catch (error) {
      if (error instanceof RoleNotFound) return undefined;
      throw error;
    }
  }
}

/** Splits the card into the Role card and the skills the Skills module keeps. */
function cardAndSkills({ skills, ...card }: RoleCard): [Omit<RoleCard, "skills">, string[]] {
  return [card, skills];
}

function ownOnlyWords(roleKey: string): string {
  return `A person acts on their own Memory and Avatar only: yours are the Role ${roleKey}'s.`;
}

/** A person's call on another's Memory or Avatar is refused; the user's request may act on anyone's. */
function ownOnly(by: PeopleCaller, key: string): void {
  if (by.kind === "person" && by.roleKey !== key) throw new RoleRefused([ownOnlyWords(by.roleKey)]);
}

/** People's refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (
      error instanceof RoleRefused ||
      error instanceof RoleNotFound ||
      error instanceof MemoryNoteNotFound ||
      error instanceof AvatarNotFound
    ) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
