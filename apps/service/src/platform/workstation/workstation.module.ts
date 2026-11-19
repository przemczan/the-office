import { Module } from "@nestjs/common";
import { NodeWorkstation, Workstation } from "./workstation.js";
import { WorkstationController } from "./workstation.controller.js";
import { WorkstationLoadReader } from "./workstation-load-reader.js";

@Module({
  controllers: [WorkstationController],
  providers: [{ provide: Workstation, useClass: NodeWorkstation }, WorkstationLoadReader],
  // For the System health recorder, which reads the workstation too.
  exports: [Workstation],
})
export class WorkstationModule {}
