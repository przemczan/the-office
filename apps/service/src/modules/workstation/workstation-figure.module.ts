import { Module } from "@nestjs/common";
import { WorkstationModule } from "../../platform/workstation/workstation.module.js";
import { WorkstationController } from "./adapters/http/workstation.controller.js";
import { WorkstationLoadReader } from "./adapters/os/workstation-load-reader.js";

/** The status strip's Workstation figure: `GET /workstation/load`, read on demand. */
@Module({
  imports: [WorkstationModule],
  controllers: [WorkstationController],
  providers: [WorkstationLoadReader],
})
export class WorkstationFigureModule {}
