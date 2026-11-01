import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProposedProject,
} from "../../../conversations/index.js";
import { ProjectRefused, type NewProject } from "../../../projects/index.js";
import { OnboardingService } from "../../application/onboarding-service.js";
import { TaskRefused } from "../../domain/task-refused.js";
import { NewProjects, type AddedProject } from "../../ports/new-projects.js";

/**
 * Proposals of a Project to onboard (spec §2.1 Defaults): applying one adds the Project through
 * Projects (`NewProjects`), whose rules judge it, then its Onboard Task. Work applies them since the Onboard Task
 * is Work's, and Projects never calls Work. A Project by Repository URL is judged with nothing
 * cloned, and cloned as it is applied, the apply waiting for the clone.
 */
@Injectable()
export class ProjectProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly projects: NewProjects,
    private readonly onboarding: OnboardingService,
  ) {}

  onModuleInit(): void {
    this.appliers.register("project", {
      problemsWith: ({ project }) => this.problemsWith(project),
      apply: (change, proposedBy) => this.apply(change, proposedBy),
    });
  }

  private async problemsWith(project: NewProject): Promise<string[]> {
    return [
      ...(await this.projects.newProjectProblems(project)),
      ...(await this.onboarding.problems()),
    ];
  }

  /**
   * Judged whole first, so a refusal leaves the Proposal open with nothing added. The Project and
   * its Task can't be added in one transaction: should the Task fail after the Project is added,
   * the refusal says so and the Proposal stays open, and applying it again carries on with the
   * Project already added, and its clone not made again.
   */
  private async apply(change: ProposedProject, proposedBy: string): Promise<ProposedProject> {
    const problems = await this.problemsWith(change.project);
    if (problems.length > 0) throw new ProposalRefused(problems);
    const project =
      (await this.addedWithoutOnboarding(change.project)) ??
      (await this.projects.add(change.project).catch(refusedAsProposal));
    const task = await this.onboarding
      .addOnboardTask(project.id, { kind: "person", roleKey: proposedBy })
      .catch((error: unknown) => {
        if (!(error instanceof TaskRefused)) throw error;
        throw new ProposalRefused([
          `${project.name} is added, but its Onboard Task isn't: ${error.reasons.join(" ")}`,
        ]);
      });
    return { ...change, projectId: project.id, taskId: task.id };
  }

  /**
   * The Project an earlier apply added before its Onboard Task failed: at the repository, under the
   * Proposal's name, not onboarded. A Project the user added there by hand isn't taken for it.
   */
  private async addedWithoutOnboarding({
    path,
    name,
  }: NewProject): Promise<AddedProject | undefined> {
    const project = await this.projects.findByPath(path);
    if (!project || project.name !== name.trim()) return undefined;
    const onboardings = await this.onboarding.list();
    return onboardings.some(({ projectId }) => projectId === project.id) ? undefined : project;
  }
}

function refusedAsProposal(error: unknown): never {
  if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
  throw error;
}
