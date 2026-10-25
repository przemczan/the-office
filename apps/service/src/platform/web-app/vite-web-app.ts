import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { ViteDevServer } from "vite";
import { isApiPath } from "../http/api-path.js";
import { WEB_APP_DIRECTORY } from "./web-app-directory.js";

/**
 * The web app compiled from its source by Vite in middleware mode, for `npm run dev`. Vite's hot
 * reload keeps its own WebSocket port, since the service's HTTP server takes only EVENTS_PATH.
 */
@Injectable()
export class ViteWebApp implements OnModuleInit, BeforeApplicationShutdown {
  private vite: ViteDevServer | undefined;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(WEB_APP_DIRECTORY) private readonly directory: string,
  ) {}

  // After Nest registered the API's routes, and before its handler for paths none of them took.
  async onModuleInit(): Promise<void> {
    // Vite is a development dependency, loaded only here.
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: this.directory,
      // Node imports vite.config.ts itself; the default bundles it to a temporary file first, whose
      // writes node --watch would take for a change of the service and restart it, again and again.
      configLoader: "native",
      appType: "spa",
      server: { middlewareMode: true },
    });
    this.vite = vite;
    this.httpAdapterHost.httpAdapter.use(
      (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        if (isApiPath(request.url ?? "/")) next();
        else vite.middlewares(request, response, next);
      },
    );
  }

  // Frees Vite's hot-reload port for the next start under node --watch.
  async beforeApplicationShutdown(): Promise<void> {
    await this.vite?.close();
  }
}
