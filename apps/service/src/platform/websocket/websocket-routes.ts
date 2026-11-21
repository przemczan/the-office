import { Injectable } from "@nestjs/common";
import type { WebSocket } from "ws";
import type { SignedIn } from "../http/signed-in-requests.js";

/** Serves one upgraded client of a route: it owns the client's messages, binary frames included. */
export type WebSocketRouteHandler = (
  client: WebSocket,
  signedIn: SignedIn,
  params: Readonly<Record<string, string>>,
) => void;

interface Route {
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly handler: WebSocketRouteHandler;
}

/**
 * The WebSocket paths modules serve besides EVENTS_PATH. A pattern is a path whose `:name` segments
 * match one segment each and give it as a param; every other segment matches exactly. The event
 * stream upgrades only signed-in devices, closes their clients on sign-out and then hands each
 * client to its route's handler, which owns its messages.
 */
@Injectable()
export class WebSocketRoutes {
  private readonly routes: Route[] = [];

  /** Registers a handler for a path pattern; the same pattern twice throws. */
  register(pattern: string, handler: WebSocketRouteHandler): void {
    if (this.routes.some((route) => route.pattern === pattern)) {
      throw new Error(`A WebSocket route is already registered for ${pattern}`);
    }
    this.routes.push({ pattern, segments: pattern.split("/"), handler });
  }

  /** The handler of a path with its params, or none when no pattern matches. */
  match(
    pathname: string,
  ): { handler: WebSocketRouteHandler; params: Record<string, string> } | undefined {
    const segments = pathname.split("/");
    for (const route of this.routes) {
      if (route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      const matches = route.segments.every((expected, index) => {
        const actual = segments[index] ?? "";
        if (!expected.startsWith(":")) return expected === actual;
        if (actual === "") return false;
        try {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } catch {
          return false;
        }
        return true;
      });
      if (matches) return { handler: route.handler, params };
    }
    return undefined;
  }
}
