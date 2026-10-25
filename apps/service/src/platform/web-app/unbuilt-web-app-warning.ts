import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

/** Says why the service serves the API but no pages: apps/web has not been built. */
@Injectable()
export class UnbuiltWebAppWarning implements OnApplicationBootstrap {
  private readonly logger = new Logger("WebApp");

  onApplicationBootstrap(): void {
    this.logger.warn("The web app is not built, so only the API is served. Run npm run build.");
  }
}
