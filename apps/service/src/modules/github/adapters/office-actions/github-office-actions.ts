import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  CHECK_GITHUB_PERMISSIONS_ACTION,
  GITHUB_OFFICE_ACTIONS,
  type GitHubState,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import { officeActionDraft, officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { GitHubPermissions } from "../../application/github-permissions.js";
import { GitHubSignIn } from "../../application/github-sign-in.js";
import { GitHubUrls } from "../../application/github-urls.js";
import { githubStateResponse } from "../http/github-state-response.js";

/**
 * One of GitHub's Office actions as GitHub carries it out: `handle` for the user's request, an
 * Agent's call and an approved call alike, its result answered to the web by `response` and
 * worded to the Agent by `words`.
 */
interface GitHubActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  /** What the approval card calls what the action changes. */
  readonly subjectTitle: string;
  handle(): Promise<Result>;
  response(result: Result): Promise<z.input<Action["answer"]>>;
  words(result: Result): string;
}

type AnyGitHubActionHandler = GitHubActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: GitHubActionHandler<Action, Result>,
): AnyGitHubActionHandler {
  return each as unknown as AnyGitHubActionHandler;
}

/**
 * GitHub's Office actions (the Office action convention): the one handler of each action GitHub
 * declares, which its route (`GitHubOfficeActionsController`) and its Office tool, registered
 * here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class GitHubOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyGitHubActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly signIn: GitHubSignIn,
    private readonly permissions: GitHubPermissions,
    private readonly urls: GitHubUrls,
  ) {
    this.handlers = new Map(
      [this.checkGitHubPermissions()].map((each) => [each.action.name, each]),
    );
    const unhandled = GITHUB_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = async () => ({
        text: await this.wordsOf(each),
        isError: false,
      });
      this.registry.register(
        officeActionTool(each.action, run, {
          draft: async (input) =>
            officeActionDraft(each.action, input, {
              title: each.subjectTitle,
              decidedBy: {},
              values: {},
            }),
          applyFor: run,
        }),
      );
    }
  }

  /** The route's answer to the action. */
  async answer(action: OfficeAction): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`GitHub carries out no Office action ${action.name}.`);
    return each.response(await each.handle());
  }

  private async wordsOf(each: AnyGitHubActionHandler): Promise<string> {
    return each.words(await each.handle());
  }

  private checkGitHubPermissions(): AnyGitHubActionHandler {
    return handler({
      action: CHECK_GITHUB_PERMISSIONS_ACTION,
      subjectTitle: "GitHub's permissions",
      handle: async () => {
        await this.permissions.checkAgain();
        return githubStateResponse(this.signIn, this.permissions, this.urls);
      },
      response: async (state: GitHubState) => state,
      words: permissionsWords,
    });
  }
}

/** The state after the check, in words: who is signed in and what the App still lacks. Never a token or a URL. */
function permissionsWords(state: GitHubState): string {
  if (state.status === "not-registered") {
    return "Checked again: The Office's GitHub App isn't registered yet, so there is nothing to check.";
  }
  if (state.status === "signed-out") {
    return "Checked again: nobody is signed in with GitHub, so the App's permissions can't be read.";
  }
  const missing = state.permissions?.missing ?? [];
  if (missing.length === 0) {
    return `Checked again: signed in as ${state.login}, and the App has every permission The Office needs (or GitHub couldn't be asked).`;
  }
  const names = missing.map(({ name, level }) => `${name} (${level})`).join(", ");
  return `Checked again: signed in as ${state.login}; the App still lacks ${names}.`;
}
