import { Module } from "@nestjs/common";
import { GitIdentityModule } from "./office-identity.module.js";
import { OfficeIdentityController } from "./adapters/http/office-identity.controller.js";

/**
 * The Office ssh key and known hosts over HTTP, for Settings › Office identity. Apart from
 * `GitIdentityModule`, which every module that runs git imports, so only the app serves the routes.
 */
@Module({ imports: [GitIdentityModule], controllers: [OfficeIdentityController] })
export class OfficeIdentityHttpModule {}
