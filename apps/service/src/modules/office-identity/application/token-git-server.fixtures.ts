import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** A git server over http that serves its repositories only to a request carrying the token. */
export interface TokenGitServer {
  /** `http://127.0.0.1:<port>`, standing in for `https://github.com`. */
  readonly origin: string;
  /** Each request's Authorization header, empty when it sent none. */
  readonly authorizations: readonly string[];
  close(): Promise<void>;
}

/**
 * `git http-backend` serving the bare repositories under `root`, as GitHub serves a private
 * repository: every request without Basic auth whose password is `token` gets a 401.
 */
export async function startTokenGitServer(root: string, token: string): Promise<TokenGitServer> {
  const authorizations: string[] = [];
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization ?? "";
    authorizations.push(authorization);
    const user = basicUserWith(authorization, token);
    if (user === undefined) {
      request.resume();
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="GitHub"' }).end();
      return;
    }
    serveByHttpBackend(root, user, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    authorizations,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function basicUserWith(authorization: string, token: string): string | undefined {
  const encoded = /^Basic (.+)$/.exec(authorization)?.[1];
  if (encoded === undefined) return undefined;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon > 0 && decoded.slice(colon + 1) === token ? decoded.slice(0, colon) : undefined;
}

/** git http-backend as a CGI program (git-http-backend(1)); it takes a push only with REMOTE_USER. */
function serveByHttpBackend(
  root: string,
  user: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const backend = spawn("git", ["http-backend"], {
    env: {
      PATH: process.env["PATH"],
      SYSTEMROOT: process.env["SYSTEMROOT"],
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      REQUEST_METHOD: request.method ?? "GET",
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.replace(/^\?/, ""),
      CONTENT_TYPE: request.headers["content-type"] ?? "",
      HTTP_CONTENT_ENCODING: request.headers["content-encoding"] ?? "",
      GIT_PROTOCOL: String(request.headers["git-protocol"] ?? ""),
      REMOTE_USER: user,
      REMOTE_ADDR: "127.0.0.1",
    },
    windowsHide: true,
  });
  request.pipe(backend.stdin);
  const output: Buffer[] = [];
  backend.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  backend.on("close", () => {
    const whole = Buffer.concat(output);
    const end = whole.indexOf("\r\n\r\n");
    const headers = whole.subarray(0, end).toString("utf8").split("\r\n");
    let status = 200;
    for (const line of headers) {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
      else response.setHeader(name, value);
    }
    response.writeHead(status).end(whole.subarray(end + 4));
  });
}
