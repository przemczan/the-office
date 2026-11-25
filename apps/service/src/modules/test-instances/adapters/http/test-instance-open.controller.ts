import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import {
  testInstanceOpenSchema,
  type TestInstanceAddresses,
  type TestInstanceOpen,
  type TestInstanceOpening,
} from "@the-office/contracts";
import type { Request } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { WorkstationAddresses } from "../../ports/workstation-addresses.js";
import { HAND_OFF_PATH } from "../proxy/node-http-proxy-listeners.js";
import { hostnameOf, reachableHostnames } from "../proxy/proxy-hosts.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

/**
 * Open on the Initiative's page and the Project page (spec §2.10, "Signing in to a test
 * instance"): the addresses a Running instance's Proxy port is reached at, the page's own first,
 * and a single-use hand-off link to the instance at the one chosen, the page's own when none is.
 * Refused (409) unless the instance is Running, and (400) at an address not offered.
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstanceOpenController {
  constructor(
    private readonly handOffs: TestInstanceHandOffs,
    private readonly officeHost: OfficeHost,
    private readonly workstation: WorkstationAddresses,
  ) {}

  @Get("test-instances/addresses")
  addresses(@Req() request: Request): TestInstanceAddresses {
    return { hostnames: this.hostnamesFor(request) };
  }

  @Post("test-instances/:id/open")
  @HttpCode(200)
  async open(
    @Param("id", ParseUUIDPipe) id: string,
    // A POST with no body chooses none.
    @Body(new ContractPipe(testInstanceOpenSchema.default({}))) chosen: TestInstanceOpen,
    @Req() request: Request,
  ): Promise<TestInstanceOpening> {
    const offered = this.hostnamesFor(request);
    const hostname = chosen.hostname?.toLowerCase() ?? offered[0];
    if (hostname === undefined || !offered.includes(hostname)) {
      throw new BadRequestException(`A test instance isn't reached at ${chosen.hostname}.`);
    }
    const { token, port } = await this.handOffs.open(id);
    return { url: `http://${hostname}:${port}${HAND_OFF_PATH}?t=${token}` };
  }

  private hostnamesFor(request: Request): string[] {
    return reachableHostnames({
      officeHost: this.officeHost.host,
      pageHostname: hostnameOf(request.headers.host ?? "localhost"),
      interfaces: this.workstation.list(),
    });
  }
}
