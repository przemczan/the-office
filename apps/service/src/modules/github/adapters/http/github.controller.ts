import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Redirect,
  Req,
} from "@nestjs/common";
import {
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  OFFICE_IDENTITY_SETTINGS_PATH,
  type GitHubSignIn as GitHubSignInAnswer,
  type GitHubState,
} from "@the-office/contracts";
import type { Request } from "express";
import { GitHubSignIn, type SignInState } from "../../application/github-sign-in.js";
import { GitHubSignInFailed } from "../../domain/sign-in.js";
import { officeOriginOf, returnUrlsOf } from "./github-return-urls.js";
import { textOrUndefined } from "./query-text.js";

/** Sign in with GitHub, from Settings › Office identity. No answer holds a token. */
@Controller("github")
export class GitHubController {
  constructor(private readonly signIn: GitHubSignIn) {}

  @Get()
  async state(): Promise<GitHubState> {
    return webStateOf(await this.signIn.state());
  }

  /** GitHub's authorize page for the browser to go to, GitHub sending it back to this Office. */
  @Post("sign-in")
  @HttpCode(200)
  async startSignIn(@Req() request: Request): Promise<GitHubSignInAnswer> {
    try {
      const { signedIn } = returnUrlsOf(officeOriginOf(request));
      return { authorizeUrl: await this.signIn.authorizeUrl(signedIn) };
    } catch (error) {
      if (error instanceof GitHubSignInFailed) throw new ConflictException(error.reason);
      throw error;
    }
  }

  /**
   * Where GitHub sends the browser back. A page the browser navigates to, so every outcome
   * redirects to Settings › Office identity, a failure carrying why.
   */
  @Get("sign-in/callback")
  @Redirect()
  async signedIn(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
    @Query("error") error: unknown,
  ): Promise<{ url: string }> {
    try {
      await this.signIn.complete({
        code: textOrUndefined(code),
        state: textOrUndefined(state),
        error: textOrUndefined(error),
      });
      return { url: OFFICE_IDENTITY_SETTINGS_PATH };
    } catch (failure) {
      if (!(failure instanceof GitHubSignInFailed)) throw failure;
      const query = new URLSearchParams({ [GITHUB_SIGN_IN_FAILED_PARAMETER]: failure.reason });
      return { url: `${OFFICE_IDENTITY_SETTINGS_PATH}?${query}` };
    }
  }

  @Delete("sign-in")
  @HttpCode(204)
  async signOut(): Promise<void> {
    await this.signIn.signOut();
  }
}

/** Only the App's slug and owner reach the web: never its client secret or a token. */
function webStateOf(state: SignInState): GitHubState {
  if (state.status === "not-registered") return state;
  const app = { slug: state.app.slug, owner: state.app.owner };
  if (state.status === "signed-in") return { status: "signed-in", app, login: state.login };
  return {
    status: "signed-out",
    app,
    ...(state.reason && { reason: { text: state.reason.text } }),
  };
}
