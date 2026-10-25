import { Controller, Get } from "@nestjs/common";
import { DatabaseHealth, type DatabaseState } from "../database/database-health.js";

export interface HealthReport {
  readonly database: DatabaseState;
}

@Controller("health")
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealth) {}

  @Get()
  async report(): Promise<HealthReport> {
    return { database: await this.databaseHealth.state() };
  }
}
