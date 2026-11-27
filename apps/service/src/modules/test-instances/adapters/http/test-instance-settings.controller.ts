import { Controller, Get } from "@nestjs/common";
import type { TestInstanceSettings } from "@the-office/contracts";
import { TestInstanceLimits } from "../../application/test-instance-limits.js";

/**
 * Settings › Office limits' Test instances card, read here; its change is an Office action
 * (`SET_TEST_INSTANCE_SETTINGS_ACTION`, routed by `TestInstanceOfficeActionsController`).
 */
@Controller("settings/test-instances")
export class TestInstanceSettingsController {
  constructor(private readonly limits: TestInstanceLimits) {}

  @Get()
  read(): Promise<TestInstanceSettings> {
    return this.limits.read();
  }
}
