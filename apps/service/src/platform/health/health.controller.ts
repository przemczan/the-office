import { Controller, Get, Optional } from "@nestjs/common";
import type { HealthReport } from "@the-office/contracts";
import { DatabaseHealth } from "../database/database-health.js";
import { OfficeTestInstance } from "../test-instance/office-test-instance.js";
import { OpenWithoutSignIn } from "../http/sign-in-guard.js";

/**
 * `/api/health`, open without sign-in: whether the database is up, and whether this service is a
 * test instance of The Office, which the web's banner shows on every page, Sign in among them.
 */
@Controller("health")
@OpenWithoutSignIn()
export class HealthController {
  constructor(
    private readonly databaseHealth: DatabaseHealth,
    @Optional() private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  ) {}

  @Get()
  async report(): Promise<HealthReport> {
    return { database: await this.databaseHealth.state(), testInstance: this.testInstance.on };
  }
}
