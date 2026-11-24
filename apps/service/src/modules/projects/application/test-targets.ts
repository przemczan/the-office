import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { entryPointProblems, sameEntryPoint, type EntryPointTree } from "../domain/entry-point.js";
import { OutputMask } from "../domain/output-mask.js";
import { INSTALL_COMMAND_KEY, type Project } from "../domain/project.js";
import type { ProjectVariable } from "../domain/project-environment.js";
import { isFeatureOn, switchedOffWords } from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { SettingChangedBy, SettingChangeUser } from "../domain/project-setting-change.js";
import { testTargetsSummary } from "../domain/setting-change-summaries.js";
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
  secretsWithoutValue,
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
import { ensureFeatureOn } from "./project-features.js";
import { ProjectService } from "./project-service.js";

/**
 * What launching a test target needs (spec §2.12): the target as kept, whether the Project's Run
 * environment is On, and the target's own variables with their values, the only ones a test
 * instance gets (spec §6, "Test instances"), never the Project's environment.
 */
export interface TestTargetLaunchSettings {
  readonly target: TestTarget;
  readonly runEnvironmentOn: boolean;
  /** The target's variables, then each Secret variable with a value, `secret` set. */
  readonly variables: readonly ProjectVariable[];
  /** The target's Secret variables with no value typed yet, by name, which `variables` leaves out. */
  readonly secretsWithoutValue: readonly string[];
  /** Hides the target's own Secret variables' values, as `[secret NAME]`, in the instance's log. */
  readonly mask: OutputMask;
  /**
   * The Project's commands the target runs in the checkout before its entry point, in its order,
   * as the Project has them now (spec §2.12, "Commands before the entry point").
   */
  readonly commandsBefore: readonly TestTargetCommandBefore[];
  /** The keys among the target's commands before the entry point the Project no longer has. */
  readonly missingCommands: readonly string[];
  /** The variable a Hosted target's port is set in; undefined for Build to install. */
  readonly portVariable: string | undefined;
  /** The target's own Memory per service in MB; undefined when the Office-wide value applies. */
  readonly memoryMegabytes: number | undefined;
}

/** One of the Project's commands as a launch runs it before the entry point. */
export interface TestTargetCommandBefore {
  readonly key: string;
  readonly name: string;
  /** The Project's command line for it, for the platform's shell. */
  readonly commandLine: string;
}

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

  /** The Project's test targets, in the order added; answered while Test targets are off too. */
  async list(projectId: string): Promise<readonly TestTarget[]> {
    await this.projects.read(projectId);
    return this.repository.listOf(projectId);
  }

  /**
   * Saves the page's whole list: a target left out is removed, a Secret variable sent without a
   * value keeps its own, and each field that changed is marked set by `user`; with no user, as for
   * a person's change on a Task (`by`), it has no known setter. Refused (FeatureSwitchedOff) while
   * the Project has Test targets switched off.
   */
  async change(
    projectId: string,
    edit: readonly EditedTestTarget[],
    user: SettingChangeUser | null,
    by: SettingChangedBy,
  ): Promise<readonly TestTarget[]> {
    const setter: TestTargetSetter | undefined = user
      ? { by: "user", user: { userId: user.userId, name: user.name } }
      : undefined;
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "test-targets");
    const commandKeys = keysOf(project);
    // Fetched before the Project is held, so no fetch runs while other changes wait.
    const before = await this.repository.listOf(projectId);
    const freshBase =
      entryPointsChanged(before, editedTestTargets(before, edit)).length > 0
        ? await this.files.freshBase(projectId)
        : undefined;
    const changed = await this.repository.update(
      projectId,
      async (stored) => {
        const edited = editedTestTargets(stored, edit);
        const problems = testTargetProblems(edited, commandKeys);
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
      },
      (stored, saved) => ({
        setting: "test-targets",
        summary: testTargetsSummary(stored, saved),
        by,
      }),
    );
    if (changed === undefined) return this.repository.listOf(projectId);
    await this.events.publish(new ProjectTestTargetsChanged(projectId));
    return changed;
  }

  /**
   * A Proposal of `given` against the Project's targets now, checked by the page's rules and its
   * entry points against the base branch's fresh tree; nothing changes until it is applied.
   * Refused (FeatureSwitchedOff) while the Project has Test targets switched off.
   */
  async propose(projectId: string, given: TestTargetsToPropose): Promise<ProposedTestTargets> {
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "test-targets");
    const commandKeys = keysOf(project);
    const current = await this.repository.listOf(projectId);
    const proposed = proposedTestTargets(current, given);
    const problems = proposedTestTargetsProblems(current, proposed, commandKeys);
    if (problems.length > 0) throw new ProjectRefused(problems);
    const entryProblems = await this.proposedEntryPointsProblems(projectId, proposed);
    if (entryProblems.length > 0) throw new ProjectRefused(entryProblems);
    return proposed;
  }

  /** Every reason the Proposal can't be applied now; empty when it can. */
  async proposedProblems(projectId: string, proposed: ProposedTestTargets): Promise<string[]> {
    const project = await this.projects.find(projectId);
    if (!project) return [new ProjectNotFound(projectId).message];
    if (!isFeatureOn(project, "test-targets"))
      return [switchedOffWords("test-targets", project.name)];
    const problems = proposedTestTargetsProblems(
      await this.repository.listOf(projectId),
      proposed,
      keysOf(project),
    );
    return problems.length > 0 ? problems : this.proposedEntryPointsProblems(projectId, proposed);
  }

  /**
   * Applies the Proposal all or nothing, checked again against the targets as they are held: a
   * Secret variable kept by name keeps its value, a new one waits for the user's, and each field it
   * changes is marked set by the Proposal. Refused (FeatureSwitchedOff) while the Project has
   * Test targets switched off.
   */
  async changeAsProposed(
    projectId: string,
    proposed: ProposedTestTargets,
    setter: { proposalId: string; agent: { roleKey: string; name: string } },
    by: SettingChangedBy,
  ): Promise<void> {
    const byProposal: TestTargetSetter = {
      by: "proposal",
      proposalId: setter.proposalId,
      agent: { roleKey: setter.agent.roleKey, name: setter.agent.name },
    };
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "test-targets");
    const commandKeys = keysOf(project);
    const toCheck = entryPointsProposed(proposed);
    const commit = toCheck.length > 0 ? await this.files.freshBase(projectId) : undefined;
    await this.repository.update(
      projectId,
      async (current) => {
        const problems = proposedTestTargetsProblems(current, proposed, commandKeys);
        if (problems.length > 0) throw new ProjectRefused(problems);
        if (commit !== undefined) {
          const entryProblems = await this.entryPointsProblems(projectId, commit, toCheck);
          if (entryProblems.length > 0) throw new ProjectRefused(entryProblems);
        }
        return appliedTargets(current, proposed, byProposal);
      },
      (stored, saved) => ({
        setting: "test-targets",
        summary: testTargetsSummary(stored, saved),
        by,
      }),
    );
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

  /**
   * What a launch of the target `key` needs, its Secret variables' values among them, which never
   * leave the service. Refused (ProjectRefused) when the Project has no such target, and
   * (FeatureSwitchedOff) while it has Test targets switched off.
   */
  async launchSettingsOf(projectId: string, key: string): Promise<TestTargetLaunchSettings> {
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "test-targets");
    const target = (await this.repository.listOf(projectId)).find((each) => each.key === key);
    if (!target)
      throw new ProjectRefused([`The Project has no test target with the key "${key}".`]);
    const secrets = target.secretVariables.flatMap(({ name, value }) =>
      value === null ? [] : [{ name, value, secret: true }],
    );
    const runnable = runnableCommandsOf(project);
    const commandsBefore = target.commandsBefore.flatMap((commandKey) =>
      runnable.filter((each) => each.key === commandKey),
    );
    return {
      target,
      runEnvironmentOn: project.runEnvironment === "on",
      commandsBefore,
      missingCommands: target.commandsBefore.filter(
        (commandKey) => !runnable.some((each) => each.key === commandKey),
      ),
      portVariable: target.kind === "build-to-install" ? undefined : target.portVariable,
      memoryMegabytes: target.memoryMegabytes ?? undefined,
      variables: [
        ...target.variables.map(({ name, value }) => ({ name, value, secret: false })),
        ...secrets,
      ],
      secretsWithoutValue: secretsWithoutValue(target),
      mask: OutputMask.ofSecrets(secrets),
    };
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

/** The keys of the Project's commands, which a target's commands before the entry point name. */
function keysOf(project: Project): string[] {
  return runnableCommandsOf(project).map(({ key }) => key);
}

/**
 * The commands a target may run before its entry point: Install, by its reserved key, when the
 * Project has an install command, since an instance's checkout has none of the image's installed
 * files; then the Project's own commands.
 */
export function runnableCommandsOf(project: Project): TestTargetCommandBefore[] {
  const install =
    project.installCommand === ""
      ? []
      : [{ key: INSTALL_COMMAND_KEY, name: "Install", commandLine: project.installCommand }];
  return [
    ...install,
    ...project.commands.map(({ key, name, commandLine }) => ({ key, name, commandLine })),
  ];
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
