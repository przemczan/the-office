import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { GITHUB_SITE, type GitHubSite } from "../../../platform/config/github-site.js";
import { GITHUB_ED25519 } from "../domain/github-host-key.js";

/** A stand-in for GitHub's meta API, which answers `body` and counts the requests. */
export interface FakeGitHubMeta {
  /** GitHub's own website, with this server as its API. */
  readonly site: GitHubSite;
  body: unknown;
  readonly requests: number;
  close(): Promise<void>;
}

export async function startFakeGitHubMeta(): Promise<FakeGitHubMeta> {
  let requests = 0;
  const fake = {
    site: GITHUB_SITE,
    body: { ssh_keys: [GITHUB_ED25519], ssh_key_fingerprints: {} } as unknown,
    get requests() {
      return requests;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  const server = createServer((_request, response) => {
    requests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(fake.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.site = {
    ...GITHUB_SITE,
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
  return fake;
}
