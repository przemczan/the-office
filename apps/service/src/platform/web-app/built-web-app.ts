import path from "node:path";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { isApiPath } from "../http/api-path.js";
import { WEB_APP_DIRECTORY } from "./web-app-directory.js";

/** The web app as `npm run build` left it in apps/web/dist. */
@Injectable()
export class BuiltWebApp implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(WEB_APP_DIRECTORY) private readonly directory: string,
  ) {}

  // After Nest registered the API's routes, and before its handler for paths none of them took.
  onModuleInit(): void {
    const files = express.static(this.directory, { index: false });
    this.httpAdapterHost.httpAdapter.use(
      (request: Request, response: Response, next: NextFunction) => {
        if (isApiPath(request.url)) {
          next();
          return;
        }
        files(request, response, () => {
          // An address of the app itself, such as /settings, gets index.html for the router to
          // open; a missing file, such as /assets/gone.js, stays a 404. Sent from `root`, so only
          // the path under it is checked for dot folders, not where The Office is, such as ~/.local.
          if (isAppAddress(request)) {
            response.sendFile("index.html", { root: this.directory, headers: NOT_CACHED });
          } else next();
        });
      },
    );
  }
}

// index.html names the current build's assets, so it is asked for again every time.
const NOT_CACHED = { "Cache-Control": "no-cache" };

function isAppAddress(request: Request): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") && path.extname(request.path) === ""
  );
}
