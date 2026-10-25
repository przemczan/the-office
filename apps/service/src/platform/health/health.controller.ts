import { Controller, Get } from "@nestjs/common";
import type { HealthReport } from "@the-office/contracts";
import { DatabaseHealth } from "../database/database-health.js";

@Controller("health")
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealth) {}

  @Get()
  async report(): Promise<HealthReport> {
    return { database: await this.databaseHealth.state() };
  }
}
