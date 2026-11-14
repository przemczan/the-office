import {
  BadGatewayException,
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
  type GitHubRepositoryList,
  type GitHubSignIn as GitHubSignInAnswer,
  type GitHubState,
} from "@the-office/contracts";
import type { Request } from "express";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { GitHubAccess } from "../../application/github-access.js";
import { GitHubSignIn, type SignInState } from "../../application/github-sign-in.js";
import { appInstallUrl, GitHubUrls } from "../../application/github-urls.js";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../../domain/github-repository.js";
import { GitHubSignInFailed } from "../../domain/sign-in.js";
import { officeOriginOf, returnUrlsOf } from "./github-return-urls.js";
import { textOrUndefined } from "../../../../platform/http/query-text.js";

/** Sign in with GitHub, from Settings › Office identity. No answer holds a token. */
@Controller("github")
export class GitHubController {
  constructor(
    private readonly signIn: GitHubSignIn,
    private readonly access: GitHubAccess,
    private readonly urls: GitHubUrls,
    private readonly addresses: OfficeAddresses,
  ) {}

  @Get()
  async state(): Promise<GitHubState> {
    return webStateOf(await this.signIn.state(), this.urls);
  }

  /** GitHub's authorize page for the browser to go to, GitHub sending it back to this Office. */
  @Post("sign-in")
  @HttpCode(200)
  async startSignIn(@Req() request: Request): Promise<GitHubSignInAnswer> {
    try {
      const { signedIn } = returnUrlsOf(officeOriginOf(request, this.addresses));
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

  /** The repositories the App is installed on that the user can reach, every page of them. */
  @Get("repositories")
  async repositories(): Promise<GitHubRepositoryList> {
    try {
      return (await this.access.repositories()).map((repository) => ({
        fullName: repository.fullName,
        repositoryUrl: repository.repositoryUrl,
        private: repository.private,
        defaultBranch: repository.defaultBranch,
        pushedAt: repository.pushedAt,
        description: repository.description,
      }));
    } catch (error) {
      if (error instanceof NotSignedInWithGitHub) throw new ConflictException(error.message);
      if (error instanceof GitHubAccessFailed) throw new BadGatewayException(error.reason);
      throw error;
    }
  }

  @Delete("sign-in")
  @HttpCode(204)
  async signOut(): Promise<void> {
    await this.signIn.signOut();
  }
}

/** Only the App's slug, owner and install page reach the web: never its client secret or a token. */
function webStateOf(state: SignInState, urls: GitHubUrls): GitHubState {
  if (state.status === "not-registered") return state;
  const { slug, owner } = state.app;
  const app = { slug, owner, installUrl: appInstallUrl(urls, slug).href };
  if (state.status === "signed-in") return { status: "signed-in", app, login: state.login };
  return {
    status: "signed-out",
    app,
    ...(state.reason && { reason: { text: state.reason.text } }),
  };
}
