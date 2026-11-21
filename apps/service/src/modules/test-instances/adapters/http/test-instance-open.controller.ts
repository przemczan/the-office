import { Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UseFilters } from "@nestjs/common";
import type { TestInstanceOpening } from "@the-office/contracts";
import type { Request } from "express";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { HAND_OFF_PATH } from "../proxy/node-http-proxy-listeners.js";
import { hostnameOf } from "../proxy/proxy-hosts.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

/**
 * Open on the Initiative's page (spec §2.10, "Signing in to a test instance"): a single-use
 * hand-off link to the Running instance's Proxy port, at the hostname The Office was reached at,
 * so a browser on the network gets the network address and one on this computer `localhost`.
 * Refused (409) unless the instance is Running.
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstanceOpenController {
  constructor(private readonly handOffs: TestInstanceHandOffs) {}

  @Post("test-instances/:id/open")
  @HttpCode(200)
  async open(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<TestInstanceOpening> {
    const { token, port } = await this.handOffs.open(id);
    const hostname = hostnameOf(request.headers.host ?? "localhost");
    return { url: `http://${hostname}:${port}${HAND_OFF_PATH}?t=${token}` };
  }
}
