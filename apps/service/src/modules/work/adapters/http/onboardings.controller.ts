import { Controller, Get } from "@nestjs/common";
import type { ProjectOnboarding } from "@the-office/contracts";
import { OnboardingService } from "../../application/onboarding-service.js";

/**
 * The Projects' onboarding, served by Work since it is read from the Onboard Task: Projects can't
 * ask Work without the two Nest modules importing each other, so the web joins it by Project.
 */
@Controller("onboardings")
export class OnboardingsController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  async list(): Promise<ProjectOnboarding[]> {
    return (await this.onboarding.list()).map(({ projectId, taskId, state }) => ({
      projectId,
      taskId,
      state,
    }));
  }
}
