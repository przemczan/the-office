import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { entryPointProblems, sameEntryPoint, type EntryPointTree } from "../domain/entry-point.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectTestTargetsChanged } from "../domain/project-events.js";
import {
  appliedTargets,
  proposedTestTargets,
  proposedTestTargetsProblems,
  type ProposedTestTargetFields,
  type ProposedTestTargets,
  type TestTargetsToPropose,
} from "../domain/proposed-test-targets.js";
import {
  editedTestTargets,
  sameTestTargets,
  setByAfter,
  testTargetLabel,
  testTargetProblems,
  type EditedTestTarget,
  type TestTarget,
  type TestTargetSetter,
} from "../domain/test-target.js";
import { TestTargetRepository } from "../ports/test-target-repository.js";
import { CommittedFiles } from "./committed-files.js";
import { DevcontainerServices } from "./devcontainer-services.js";
import { ProjectService } from "./project-service.js";

/** A target, or a Proposal's, whose entry point is checked against a commit. */
type EntryPointOwner = Pick<ProposedTestTargetFields, "key" | "entryPoint">;

/**
 * A Project's test targets (spec §2.12): written whole on the Project page or by an applied
 * Proposal, each by the page's rules and with its entry point checked against the base branch's
 * fresh tree when it is new or changed; each field records who set it last.
 */
@Injectable()
export class TestTargets {
  constructor(
    private readonly projects: ProjectService,
    private readonly repository: TestTargetRepository,
    private readonly files: CommittedFiles,
    private readonly devcontainerServices: DevcontainerServices,
    private readonly events: EventBus,
  ) {}

  /** The Project's test targets, in the order added. */
  async list(projectId: string): Promise<readonly TestTarget[]> {
    await this.projects.read(projectId);
    return this.repository.listOf(projectId);
  }

  /**
   * Saves the page's whole list: a target left out is removed, a Secret variable sent without a
   * value keeps its own, and each field that changed is marked set by `user`.
   */
  async change(
    projectId: string,
    edit: readonly EditedTestTarget[],
    user: { userId: string; name: string },
  ): Promise<readonly TestTarget[]> {
    const setter: TestTargetSetter = { by: "user", user: { userId: user.userId, name: user.name } };
    // Fetched before the Project is held, so no fetch runs while other changes wait.
    const before = await this.list(projectId);
    const freshBase =
      entryPointsChanged(before, editedTestTargets(before, edit)).length > 0
        ? await this.files.freshBase(projectId)
        : undefined;
    const changed = await this.repository.update(projectId, async (stored) => {
      const edited = editedTestTargets(stored, edit);
      const problems = testTargetProblems(edited);
      if (problems.length > 0) throw new ProjectRefused(problems);
      const toCheck = entryPointsChanged(stored, edited);
      if (toCheck.length > 0) {
        const commit = freshBase ?? (await this.files.freshBase(projectId));
        const entryProblems = await this.entryPointsProblems(projectId, commit, toCheck);
        if (entryProblems.length > 0) throw new ProjectRefused(entryProblems);
      }
      const after = edited.map((target) => ({
        ...target,
        setBy: setByAfter(
          stored.find(({ key }) => key === target.key),
          target,
          setter,
        ),
      }));
      return sameTestTargets(stored, after) ? undefined : after;
    });
    if (changed === undefined) return this.repository.listOf(projectId);
    await this.events.publish(new ProjectTestTargetsChanged(projectId));
    return changed;
  }

  /**
   * A Proposal of `given` against the Project's targets now, checked by the page's rules and its
   * entry points against the base branch's fresh tree; nothing changes until it is applied.
   */
  async propose(projectId: string, given: TestTargetsToPropose): Promise<ProposedTestTargets> {
    const current = await this.list(projectId);
    const proposed = proposedTestTargets(current, given);
    const problems = proposedTestTargetsProblems(current, proposed);
    if (problems.length > 0) throw new ProjectRefused(problems);
    const entryProblems = await this.proposedEntryPointsProblems(projectId, proposed);
    if (entryProblems.length > 0) throw new ProjectRefused(entryProblems);
    return proposed;
  }

  /** Every reason the Proposal can't be applied now; empty when it can. */
  async proposedProblems(projectId: string, proposed: ProposedTestTargets): Promise<string[]> {
    const project = await this.projects.find(projectId);
    if (!project) return [new ProjectNotFound(projectId).message];
    const problems = proposedTestTargetsProblems(await this.repository.listOf(projectId), proposed);
    return problems.length > 0 ? problems : this.proposedEntryPointsProblems(projectId, proposed);
  }

  /**
   * Applies the Proposal all or nothing, checked again against the targets as they are held: a
   * Secret variable kept by name keeps its value, a new one waits for the user's, and each field it
   * changes is marked set by the Proposal.
   */
  async changeAsProposed(
    projectId: string,
    proposed: ProposedTestTargets,
    setter: { proposalId: string; agent: { roleKey: string; name: string } },
  ): Promise<void> {
    const byProposal: TestTargetSetter = {
      by: "proposal",
      proposalId: setter.proposalId,
      agent: { roleKey: setter.agent.roleKey, name: setter.agent.name },
    };
    await this.projects.read(projectId);
    const toCheck = entryPointsProposed(proposed);
    const commit = toCheck.length > 0 ? await this.files.freshBase(projectId) : undefined;
    await this.repository.update(projectId, async (current) => {
      const problems = proposedTestTargetsProblems(current, proposed);
      if (problems.length > 0) throw new ProjectRefused(problems);
      if (commit !== undefined) {
        const entryProblems = await this.entryPointsProblems(projectId, commit, toCheck);
        if (entryProblems.length > 0) throw new ProjectRefused(entryProblems);
      }
      return appliedTargets(current, proposed, byProposal);
    });
    await this.events.publish(new ProjectTestTargetsChanged(projectId));
  }

  /**
   * Why the target `key`'s entry point isn't one of the repository's at `commit`, such as the tip
   * of the branch being launched (spec §2.12, "Entry points only"); empty when it is.
   */
  async entryPointProblemsAt(projectId: string, commit: string, key: string): Promise<string[]> {
    const target = (await this.list(projectId)).find((each) => each.key === key);
    if (!target) return [`The Project has no test target with the key "${key}".`];
    return this.entryPointsProblems(projectId, commit, [target]);
  }

  private async proposedEntryPointsProblems(
    projectId: string,
    proposed: ProposedTestTargets,
  ): Promise<string[]> {
    const toCheck = entryPointsProposed(proposed);
    if (toCheck.length === 0) return [];
    return this.entryPointsProblems(projectId, await this.files.freshBase(projectId), toCheck);
  }

  private async entryPointsProblems(
    projectId: string,
    commit: string,
    targets: readonly EntryPointOwner[],
  ): Promise<string[]> {
    const tree = this.treeAt(projectId, commit);
    const problems = await Promise.all(
      targets.map(async ({ key, entryPoint }) =>
        (await entryPointProblems(entryPoint, tree)).map(
          (problem) => `${testTargetLabel(key)}: ${problem}`,
        ),
      ),
    );
    return problems.flat();
  }

  private treeAt(projectId: string, commit: string): EntryPointTree {
    let services: Promise<readonly string[] | undefined> | undefined;
    return {
      isFile: (path) => this.files.isFileAt(projectId, commit, path),
      textAt: (path) => this.files.textAt(projectId, commit, path),
      devcontainerServices: () =>
        (services ??= this.devcontainerServices.servicesAt(projectId, commit)),
    };
  }
}

/** The targets of `edited` added, or whose entry point changed from `stored`'s. */
function entryPointsChanged(
  stored: readonly TestTarget[],
  edited: readonly TestTarget[],
): TestTarget[] {
  return edited.filter((target) => {
    const before = stored.find(({ key }) => key === target.key);
    return !before || !sameEntryPoint(before.entryPoint, target.entryPoint);
  });
}

/** The targets a Proposal adds, or whose entry point it changes. */
function entryPointsProposed(proposed: ProposedTestTargets): EntryPointOwner[] {
  return proposed.targets.flatMap(({ from, to }) =>
    to !== null && (from === null || !sameEntryPoint(from.entryPoint, to.entryPoint)) ? [to] : [],
  );
}
