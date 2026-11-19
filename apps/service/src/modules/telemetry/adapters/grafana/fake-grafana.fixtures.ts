import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { recorded, type RecordedAnswer, type RecordingName } from "./grafana-scenario.fixtures.js";

/** A request the fake Grafana took, its body read as JSON. */
export interface TakenRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

/** What the fake answers a path with: a recorded answer, or nothing at all (to time out). */
export type FakeAnswer = RecordedAnswer | "never";

/** The recordings a query is answered with, by its first query's refId. */
const BY_FIRST_REF: Readonly<Record<string, RecordingName>> = {
  tokens: "usage",
  windows: "windows",
  topTasks: "costliest-top",
  taskCost: "costliest-breakdown",
  initiativeCost: "costliest-breakdown",
  lagP99: "system-health-responsiveness",
  officeCpu: "system-health-cpu-and-memory",
  requestsPerMinute: "system-health-requests",
  queriesPerMinute: "system-health-database",
};

/**
 * A Grafana on 127.0.0.1 and a free port serving the recorded answers: `GET /api/datasources`
 * and `POST /api/ds/query`, the recording picked by the query's refIds. `answers` overrides a
 * path's answer.
 */
export class FakeGrafana {
  readonly requests: TakenRequest[] = [];
  readonly answers = new Map<string, FakeAnswer>();
  /** Overrides the answer of `POST /api/ds/query` to a request by its first query's refId. */
  readonly queryAnswers = new Map<string, FakeAnswer>();
  private constructor(private readonly server: Server) {}

  static async start(): Promise<FakeGrafana> {
    const server = createServer();
    const fake = new FakeGrafana(server);
    server.on("request", (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const path = request.url ?? "/";
        const body = text === "" ? undefined : (JSON.parse(text) as unknown);
        fake.requests.push({
          method: request.method ?? "GET",
          path,
          headers: request.headers,
          body,
        });
        const answer =
          fake.answers.get(path) ?? fake.queryAnswerFor(path, body) ?? fake.recordedFor(path, body);
        if (answer === "never") return;
        response.writeHead(answer.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(answer.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return fake;
  }

  get address(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** The bodies of the data source queries taken, in order. */
  queries(): {
    queries: { refId: string; expr: string; [field: string]: unknown }[];
    from: string;
    to: string;
  }[] {
    return this.requests
      .filter((request) => request.path === "/api/ds/query")
      .map((request) => request.body as ReturnType<FakeGrafana["queries"]>[number]);
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private queryAnswerFor(path: string, body: unknown): FakeAnswer | undefined {
    return path === "/api/ds/query" ? this.queryAnswers.get(firstRefOf(body)) : undefined;
  }

  private recordedFor(path: string, body: unknown): RecordedAnswer {
    if (path === "/api/datasources") return recorded("data-sources");
    if (path === "/api/ds/query") {
      const name = BY_FIRST_REF[firstRefOf(body)];
      if (name) return recorded(name);
    }
    return { range: null, status: 404, body: { message: "Not found" } };
  }
}

function firstRefOf(body: unknown): string {
  return (body as { queries: { refId: string }[] }).queries[0]?.refId ?? "";
}

/** A port nothing listens on, a moment ago free. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
