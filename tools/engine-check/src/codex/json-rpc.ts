/**
 * The app-server's framing: one JSON-RPC 2.0 message per line on stdin and stdout, without the
 * `"jsonrpc"` member. A line is a response when it has an id and no method, a server request when it
 * has both, a notification when it has a method only.
 */

export type RequestId = string | number;

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export type IncomingMessage =
  | { readonly kind: "response"; readonly id: RequestId; readonly result: unknown }
  | { readonly kind: "error"; readonly id: RequestId; readonly error: JsonRpcError }
  | {
      readonly kind: "request";
      readonly id: RequestId;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown };

/** The JSON-RPC code for a method the client doesn't serve. */
export const METHOD_NOT_FOUND = -32601;
/** The JSON-RPC code for a request the client failed to answer. */
export const INTERNAL_ERROR = -32603;

export function readMessage(line: string): IncomingMessage {
  const message = JSON.parse(line) as Record<string, unknown>;
  const { id, method, params } = message;
  if (typeof method === "string") {
    return isRequestId(id)
      ? { kind: "request", id, method, params }
      : { kind: "notification", method, params };
  }
  if (!isRequestId(id)) {
    throw new Error(`A JSON-RPC line with neither a method nor an id: ${line}`);
  }
  if (message["error"] !== undefined) {
    return { kind: "error", id, error: message["error"] as JsonRpcError };
  }
  return { kind: "response", id, result: message["result"] };
}

export function requestLine(id: RequestId, method: string, params: unknown): string {
  return messageLine({ id, method, params });
}

export function notificationLine(method: string, params?: unknown): string {
  return messageLine(params === undefined ? { method } : { method, params });
}

export function resultLine(id: RequestId, result: unknown): string {
  return messageLine({ id, result });
}

export function errorLine(id: RequestId, error: JsonRpcError): string {
  return messageLine({ id, error });
}

function messageLine(message: Record<string, unknown>): string {
  return `${JSON.stringify(message)}\n`;
}

function isRequestId(id: unknown): id is RequestId {
  return typeof id === "string" || typeof id === "number";
}
