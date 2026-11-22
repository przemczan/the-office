import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProposedFeatureSwitches,
  type ProposedProject,
} from "../../../conversations/index.js";
import {
  ProjectRefused,
  type NewProject,
  type ProjectFeatureSwitches,
} from "../../../projects/index.js";
import { OnboardingService } from "../../application/onboarding-service.js";
import { NewProjects, type AddedProject } from "../../ports/new-projects.js";

/**
 * Proposals of a Project to onboard (spec §2.1 Defaults): applying one adds the Project through
 * Projects (`NewProjects`), whose rules judge it, then makes and starts its Onboard Task, an
 * Off-board Task. Work applies them since the Onboard Task is Work's, and Projects never calls Work. A Project by Repository URL is judged with nothing
 * cloned, and cloned as it is applied, the apply waiting for the clone.
 */
@Injectable()
export class ProjectProposals implements OnModuleInit {
  private readonly logger = new Logger(ProjectProposals.name);

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
   * Judged whole first, so a refusal leaves the Proposal open with nothing added. The Project is
   * added whatever its Onboard Task's start meets: a refused start makes no Task, and the Proposal
   * is applied with none, the Project page offering Onboard. Applying again after a failure carries
   * on with the Project already added, and its clone not made again.
   */
  private async apply(change: ProposedProject, proposedBy: string): Promise<ProposedProject> {
    const problems = await this.problemsWith(change.project);
    if (problems.length > 0) throw new ProposalRefused(problems);
    const project =
      (await this.addedWithoutOnboarding(change.project)) ??
      (await this.projects
        .add({ ...change.project, features: switchesOf(change.features ?? {}) })
        .catch(refusedAsProposal));
    const start = await this.onboarding.onboard(project.id, {
      kind: "person",
      roleKey: proposedBy,
    });
    if (start.outcome === "refused") {
      this.logger.warn(
        `${project.name} is added, but its Onboard Task didn't start: ${start.reasons.join(" ")}`,
      );
      return { ...change, projectId: project.id, taskId: undefined };
    }
    return { ...change, projectId: project.id, taskId: start.offBoardTask.taskId };
  }

  /**
   * The Project an earlier apply added before it failed: at the repository, under the Proposal's
   * name, not onboarded or with an Onboard Task made before they started at once still Ready. A
   * Project the user added there by hand isn't taken for it.
   */
  private async addedWithoutOnboarding({
    path,
    name,
  }: NewProject): Promise<AddedProject | undefined> {
    const project = await this.projects.findByPath(path);
    if (!project || project.name !== name.trim()) return undefined;
    const onboardings = await this.onboarding.list();
    if (!onboardings.some(({ projectId }) => projectId === project.id)) return project;
    return (await this.onboarding.waitingOnboardTaskOf(project.id)) ? project : undefined;
  }
}

/**
 * The switches as proposed, stored as they are: Connected devices proposed on is stored on while
 * the new Project's Run environment is not decided yet, and reads on once it is On.
 */
function switchesOf(features: ProposedFeatureSwitches): ProjectFeatureSwitches {
  return Object.fromEntries(
    Object.entries(features).flatMap(([feature, proposed]) =>
      proposed ? [[feature, proposed.on]] : [],
    ),
  );
}

function refusedAsProposal(error: unknown): never {
  if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
  throw error;
}
