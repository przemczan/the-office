import { Injectable } from "@nestjs/common";
import { GitHubIdentities, GitHubIdentityFailed } from "../../../github/index.js";
import {
  IdentityProvider,
  IdentityProviderFailed,
  type IdentityAuthorization,
  type IdentityReturn,
  type ProviderAnswer,
} from "../../ports/identity-provider.js";

/**
 * Continue with GitHub, through the github module's GitHub App, the one registered for Sign in
 * with GitHub, which this never touches. GitHub sends the browser back to any callback URL the App
 * lists, plain HTTP on an IP included, so it works at every address.
 */
@Injectable()
export class GitHubIdentityProvider extends IdentityProvider {
  readonly provider = "github";

  constructor(private readonly gitHub: GitHubIdentities) {
    super();
  }

  isAvailable(): Promise<boolean> {
    return this.gitHub.isAvailable();
  }

  unavailableAt(): undefined {
    return undefined;
  }

  authorizeUrl(authorization: IdentityAuthorization): Promise<string> {
    return this.gitHub.authorizeUrl(authorization).catch(failed);
  }

  identityOf(returned: IdentityReturn): Promise<ProviderAnswer> {
    return this.gitHub.identityOf(returned).catch(failed);
  }
}

function failed(error: unknown): never {
  if (error instanceof GitHubIdentityFailed) throw new IdentityProviderFailed(error.reason);
  throw error;
}
