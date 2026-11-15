import { Controller, Get } from "@nestjs/common";
import type { LiveView as LiveViewResponse } from "@the-office/contracts";
import { LiveView } from "../../application/live-view.js";
import { toLiveViewResponse } from "./live-view-responses.js";

/** The Live view: what each person of The Office is doing now. */
@Controller("live-view")
export class LiveViewController {
  constructor(private readonly liveView: LiveView) {}

  @Get()
  async read(): Promise<LiveViewResponse> {
    return toLiveViewResponse(await this.liveView.read());
  }
}
