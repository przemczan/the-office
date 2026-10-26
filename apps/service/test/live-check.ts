import type { Message } from "@the-office/contracts";

/** A call to the service's API, as the web makes it. */
export type ApiCall = (method: string, path: string, body?: unknown) => Promise<Response>;
/** The same call, its JSON answer read, failing on any status but 2xx. */
export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

/** The API of a service serving at `url`, for the live checks on the Test Project. */
export function checkApi(url: string): { readonly call: ApiCall; readonly api: Api } {
  const call: ApiCall = async (method, path, body) =>
    fetch(`${url}/api${path}`, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  const api: Api = async (method, path, body) => {
    const response = await call(method, path, body);
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
    return text === "" ? undefined : JSON.parse(text);
  };
  return { call, api };
}

/** One line of a check's report for a Thread's message. */
export function messageLine(message: Message): string {
  switch (message.kind) {
    case "user":
    case "person":
    case "handover-note":
      return `${message.kind}: ${message.text.replaceAll("\n", " / ")}`;
    case "tool-activity":
      return `tool ${message.tool}: ${message.summary}`;
    case "context":
      return `context ${message.move} (${message.reason}), context ${message.contextTokens}, brief ${message.briefTokens}`;
    case "failure":
      return `failure: ${message.reason}`;
    case "held":
      return `held (${message.heldBy}): ${message.text}`;
    case "decision": {
      const { question, options, recommendation } = message.decision;
      return `decision: ${question} [${options.join(" | ")}], recommends ${recommendation.option + 1}: ${recommendation.reason}`;
    }
    case "decision-answer":
      return `decision-answer: ${JSON.stringify(message.answer)}`;
    case "refusal":
      return `refusal ${message.tool}: ${message.reason}`;
  }
}
