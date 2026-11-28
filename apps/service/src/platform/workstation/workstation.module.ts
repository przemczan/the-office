import { Module } from "@nestjs/common";
import { NodeWorkstation, Workstation } from "./workstation.js";

/**
 * The workstation's CPU and memory, read from Node's `os`: for the System health recorder and the
 * Workstation module's Workstation figure.
 */
@Module({
  providers: [{ provide: Workstation, useClass: NodeWorkstation }],
  exports: [Workstation],
})
export class WorkstationModule {}
