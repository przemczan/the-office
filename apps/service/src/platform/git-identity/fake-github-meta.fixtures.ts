import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** GitHub's own ed25519 host key, as its meta API publishes it. */
export const GITHUB_ED25519 =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

/** A stand-in for GitHub's meta API, which answers `body` and counts the requests. */
export interface FakeGitHubMeta {
  readonly url: string;
  body: unknown;
  readonly requests: number;
  close(): Promise<void>;
}

export async function startFakeGitHubMeta(): Promise<FakeGitHubMeta> {
  let requests = 0;
  const fake = {
    url: "",
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
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/meta`;
  return fake;
}
