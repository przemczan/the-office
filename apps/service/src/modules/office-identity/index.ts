export {
  GitHubUserTokenModule,
  GitIdentityModule,
  type GitHubUserTokenOptions,
} from "./office-identity.module.js";
export { OfficeIdentityHttpModule } from "./office-identity-http.module.js";
export { OfficeIdentity, type GitCommandIdentity } from "./application/office-identity.js";
export { OfficeKnownHosts } from "./application/office-known-hosts.js";
export { OfficeSshKey } from "./application/office-ssh-key.js";
export { parseGitRemote, type GitRemote } from "./domain/git-remote.js";
export { GITHUB_ED25519 } from "./domain/github-host-key.js";
export { hostKeyOf, type HostKey } from "./domain/host-keys.js";
export type { MissingForSsh, RemoteNeeds } from "./domain/remote-needs.js";
export { GitHubUserToken } from "./ports/github-user-token.js";
/** For the end-to-end service, which scans no real host. */
export { HostKeyScanner } from "./ports/host-key-scanner.js";
