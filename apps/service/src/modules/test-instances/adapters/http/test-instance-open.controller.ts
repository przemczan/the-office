import { Controller, Get, Req, UseFilters } from "@nestjs/common";
import type { TestInstanceAddresses } from "@the-office/contracts";
import type { Request } from "express";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { WorkstationAddresses } from "../../ports/workstation-addresses.js";
import { hostnameOf, reachableHostnames } from "../proxy/proxy-hosts.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

/**
 * The addresses Open offers on the Initiative's page and the Project page (spec §2.10, "Signing in
 * to a test instance"): the hostnames a Running instance's Proxy port is reached at, the page's own
 * first. Open itself is an Office action (`TestInstanceOfficeActionsController`).
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstanceOpenController {
  constructor(
    private readonly officeHost: OfficeHost,
    private readonly workstation: WorkstationAddresses,
  ) {}

  @Get("test-instances/addresses")
  addresses(@Req() request: Request): TestInstanceAddresses {
    return {
      hostnames: reachableHostnames({
        officeHost: this.officeHost.host,
        pageHostname: hostnameOf(request.headers.host ?? "localhost"),
        interfaces: this.workstation.list(),
      }),
    };
  }
}
