import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { IdentityFolder } from "./identity-folder.js";
import { forSh, shellQuoted } from "./sh-words.js";

/** What The Office answers git's `credential fill` with: the token, or why there is none. */
export type GitCredentialAnswer =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "refused"; readonly reason: string };

/** One git command's leave to ask The Office for one origin's credentials. */
export interface GitCredentialGrant {
  /** Go after the identity's `credential.helper=`, which clears every helper before them. */
  readonly configArguments: readonly string[];
  /** Ends the leave once the command has exited. */
  release(): void;
}

interface Grant {
  readonly protocol: string;
  readonly host: string;
  readonly answer: () => Promise<GitCredentialAnswer>;
}

interface Listening {
  readonly server: Server;
  readonly port: number;
}

/** GitHub takes any user name with a user token; this is the one its docs use. */
const USER_NAME = "x-access-token";

/** git's request is a few short lines; anything longer isn't git's. */
const REQUEST_LIMIT_BYTES = 16 * 1024;

/**
 * The helper git runs: it forwards git's request to The Office over loopback with the command's
 * secret and prints the answer, or prints why there is none and tells git to stop asking. It holds
 * no secret itself; `store` and `erase` are ignored, as The Office keeps the token.
 */
const HELPER_SCRIPT = `"use strict";
// The Office's git credential helper (spec 5.5 Defaults): asks The Office, which runs this git
// command, for the token, so the token is in no file, argument or environment variable.
const http = require("node:http");
const [, , port, secret, operation] = process.argv;
if (operation !== "get") process.exit(0);
const refuse = (reason) => {
  process.stderr.write(reason + "\\n");
  process.stdout.write("quit=1\\n");
};
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const request = http.request(
    { host: "127.0.0.1", port: Number(port), method: "POST", headers: { authorization: "Bearer " + secret } },
    (response) => {
      const answer = [];
      response.on("data", (chunk) => answer.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(answer).toString("utf8");
        if (response.statusCode === 200) process.stdout.write(text);
        else refuse(text);
      });
    },
  );
  request.on("error", (error) => refuse("The Office couldn't be asked for the token: " + error.message));
  request.end(Buffer.concat(chunks));
});
`;

/**
 * The credential helper Office code answers (spec §5.5 Defaults, the Office identity): git asks
 * The Office's loopback listener for an origin's credentials, with a secret good for one command
 * and that origin only. The token goes from The Office to git's helper over the socket, never into
 * a file, an argument or an environment variable, which hooks, filters and Agents could read.
 */
@Injectable()
export class GitCredentialHelper implements OnModuleDestroy {
  private readonly grants = new Map<string, Grant>();
  private listening: Promise<Listening> | undefined;
  private script: Promise<string> | undefined;

  constructor(private readonly folder: IdentityFolder) {}

  /** Lets one git command ask for `origin`'s credentials, which `answer` gives when it asks. */
  async grant(
    origin: string,
    answer: () => Promise<GitCredentialAnswer>,
  ): Promise<GitCredentialGrant> {
    const [{ port }, script] = await Promise.all([this.listen(), this.helperScript()]);
    const url = new URL(origin);
    const secret = randomBytes(32).toString("hex");
    this.grants.set(secret, { protocol: url.protocol.replace(/:$/, ""), host: url.host, answer });
    const helper = [process.execPath, script].map((path) => shellQuoted(forSh(path)));
    return {
      configArguments: [
        "-c",
        `credential.${url.origin}.helper=!${helper.join(" ")} ${port} ${secret}`,
      ],
      release: () => {
        this.grants.delete(secret);
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    const listening = this.listening;
    this.listening = undefined;
    if (listening === undefined) return;
    const { server } = await listening;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private listen(): Promise<Listening> {
    this.listening ??= listenOnLoopback((request, response) => {
      void this.answer(request, response);
    }).catch((error: unknown) => {
      this.listening = undefined;
      throw error;
    });
    return this.listening;
  }

  private helperScript(): Promise<string> {
    this.script ??= this.folder
      .fileHolding("git-credential-helper", ".cjs", HELPER_SCRIPT)
      .catch((error: unknown) => {
        this.script = undefined;
        throw error;
      });
    return this.script;
  }

  private async answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const secret = /^Bearer ([0-9a-f]+)$/.exec(request.headers.authorization ?? "")?.[1];
    const grant = secret === undefined ? undefined : this.grants.get(secret);
    const asked = parseCredentialRequest(await body(request));
    if (grant === undefined || request.method !== "POST" || asked === undefined) {
      return refuse(response, 403, "The Office gives credentials only to a git command it runs.");
    }
    if (asked.get("protocol") !== grant.protocol || asked.get("host") !== grant.host) {
      return refuse(response, 403, "The Office's credentials are not for this host.");
    }
    const answer = await grant.answer().catch((error: unknown): GitCredentialAnswer => ({
      kind: "refused",
      reason: error instanceof Error ? error.message : String(error),
    }));
    if (answer.kind === "refused") return refuse(response, 409, answer.reason);
    response
      .writeHead(200, { "content-type": "text/plain" })
      .end(`username=${USER_NAME}\npassword=${answer.token}\n`);
  }
}

function listenOnLoopback(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Listening> {
  return new Promise((resolve, reject) => {
    const server = createServer(handle);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      // A listener no command is using never keeps the process alive.
      server.unref();
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function refuse(response: ServerResponse, status: number, reason: string): void {
  response.writeHead(status, { "content-type": "text/plain" }).end(reason);
}

/** The request's body, or undefined when it is longer than git's could be. */
async function body(request: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    length += chunk.length;
    if (length > REQUEST_LIMIT_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** git's `key=value` lines (git-credential(1), "Input/Output Format"). */
function parseCredentialRequest(text: string | undefined): Map<string, string> | undefined {
  if (text === undefined) return undefined;
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const equals = line.indexOf("=");
    if (equals > 0) fields.set(line.slice(0, equals), line.slice(equals + 1));
  }
  return fields;
}
