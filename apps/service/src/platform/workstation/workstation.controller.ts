import { Controller, Get } from "@nestjs/common";
import type { WorkstationLoad } from "@the-office/contracts";
import { WorkstationLoadReader } from "./workstation-load-reader.js";

@Controller("workstation")
export class WorkstationController {
  constructor(private readonly loadReader: WorkstationLoadReader) {}

  /** The Workstation figure's CPU and memory, which the web polls every 2 s. */
  @Get("load")
  load(): WorkstationLoad {
    return this.loadReader.read();
  }
}
