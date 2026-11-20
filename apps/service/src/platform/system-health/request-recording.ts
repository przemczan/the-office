import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Where the requests' durations go: the System health recorder. */
export interface RequestDurations {
  recordRequest(method: string, template: string | null, durationMs: number): void;
}

/**
 * Records each request's duration once its response finishes, by its method and the route
 * template that answered it (`req.baseUrl` + `req.route.path`, such as `/api/tasks/:id`), never
 * the address asked for; a request no route answered is recorded with none, "Unmatched". Put it
 * first, so the duration covers every middleware after it.
 */
export function recordRequests(durations: RequestDurations): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = performance.now();
    response.once("finish", () => {
      durations.recordRequest(
        request.method,
        routeTemplateOf(request),
        performance.now() - startedAt,
      );
    });
    next();
  };
}

function routeTemplateOf(request: Request): string | null {
  // Express types `route` as any; it is set only once a route matched.
  const route: unknown = request.route;
  if (typeof route !== "object" || route === null || !("path" in route)) return null;
  const { path } = route;
  if (typeof path !== "string" || isNestNotFoundRoute(request.baseUrl, path)) return null;
  return `${request.baseUrl}${path}`;
}

/**
 * Nest answers a path under the global prefix that no route takes with a route of its own: `*path`
 * on a router mounted at the prefix. Its own routes are on the app's router, with no base.
 */
function isNestNotFoundRoute(baseUrl: string, path: string): boolean {
  return baseUrl !== "" && path === "*path";
}
