import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  actionLabel,
  actionProblems,
  editedActions,
  removedKeys,
  sameActions,
  sameSettings,
  setByAfter,
  workflowFileName,
  type Action,
  type ActionContext,
  type ActionFields,
  type ActionSetter,
  type WorkflowActionSettings,
} from "../domain/action.js";
import { inputsToSend } from "../domain/manual-workflow.js";
import { INSTALL_COMMAND_KEY, type Project } from "../domain/project.js";
import { ProjectActionsChanged } from "../domain/project-events.js";
import { isFeatureOn, switchedOffWords } from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { SettingChangedBy, SettingChangeUser } from "../domain/project-setting-change.js";
import { actionsSummary } from "../domain/setting-change-summaries.js";
import {
  appliedActions,
  proposedActions,
  proposedActionsProblems,
  type ActionsToPropose,
  type ProposedActions,
} from "../domain/proposed-actions.js";
import { ActionRepository } from "../ports/action-repository.js";
import { TestTargetRepository } from "../ports/test-target-repository.js";
import { ManualWorkflows, type ManualWorkflowList } from "./manual-workflows.js";
import { ProjectDeviceLines } from "./project-device-lines.js";
import { ensureFeatureOn } from "./project-features.js";
import { ProjectService } from "./project-service.js";

/** A Workflow Action whose file and inputs are checked against the base branch. */
interface WorkflowToCheck {
  readonly key: string;
  readonly settings: WorkflowActionSettings;
}

/**
 * A Project's Actions (spec §2.15, "Defining Actions"): written whole on the Project page or by an
 * applied Proposal, each by the page's rules, a Workflow's file and inputs checked against what the
 * base branch declares when new or changed; each value records who set it last. Running them is
 * the Actions module's.
 */
@Injectable()
export class ProjectActions {
  constructor(
    private readonly projects: ProjectService,
    private readonly repository: ActionRepository,
    private readonly testTargets: TestTargetRepository,
    private readonly workflows: ManualWorkflows,
    private readonly devices: ProjectDeviceLines,
    private readonly events: EventBus,
  ) {}

  /** The Project's Actions, in the order added; answered while Actions are off too. */
  async list(projectId: string): Promise<readonly Action[]> {
    await this.projects.read(projectId);
    return this.repository.listOf(projectId);
  }

  /**
   * Saves the page's whole list: an Action left out is removed, Leaves the workstation is kept as
   * sent (the editor ticks it for a Workflow, and the user may clear it), and each value that
   * changed is marked set by `user`; with no user, as for a person's change on a Task (`by`), it
   * has no known setter.
   * Refused (FeatureSwitchedOff) while the Project has Actions switched off.
   */
  async change(
    projectId: string,
    edit: readonly ActionFields[],
    user: SettingChangeUser | null,
    by: SettingChangedBy,
  ): Promise<readonly Action[]> {
    const setter: ActionSetter | undefined = user
      ? { by: "user", user: { userId: user.userId, name: user.name } }
      : undefined;
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "actions");
    const context = await this.contextOf(project);
    // The code host is asked before the Project is held, so no request runs while other changes wait.
    const before = await this.repository.listOf(projectId);
    const listed = await this.workflowsFor(
      project,
      workflowsChanged(before, editedActions(before, edit)),
    );
    let removed: string[] = [];
    const changed = await this.repository.update(
      projectId,
      async (stored) => {
        const edited = editedActions(stored, edit);
        const problems = actionProblems(edited, context);
        if (problems.length > 0) throw new ProjectRefused(problems);
        const toCheck = workflowsChanged(stored, edited);
        const workflowProblems = workflowsProblems(
          project,
          toCheck,
          listed ?? (await this.workflowsFor(project, toCheck)),
        );
        if (workflowProblems.length > 0) throw new ProjectRefused(workflowProblems);
        const after = edited.map((action) => ({
          ...action,
          setBy: setByAfter(
            stored.find(({ key }) => key === action.key),
            action,
            setter,
          ),
        }));
        removed = removedKeys(stored, after);
        return sameActions(stored, after) ? undefined : after;
      },
      (stored, saved) => ({
        setting: "actions",
        summary: actionsSummary(stored, saved),
        by,
      }),
    );
    if (changed === undefined) return this.repository.listOf(projectId);
    await this.events.publish(new ProjectActionsChanged(projectId, removed));
    return changed;
  }

  /**
   * A Proposal of `given` against the Project's Actions now, checked by the page's rules and its
   * Workflows against the base branch; nothing changes until it is applied. Refused
   * (FeatureSwitchedOff) while the Project has Actions switched off.
   */
  async propose(projectId: string, given: ActionsToPropose): Promise<ProposedActions> {
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "actions");
    const current = await this.repository.listOf(projectId);
    const proposed = proposedActions(current, given);
    const problems = proposedActionsProblems(current, proposed, await this.contextOf(project));
    if (problems.length > 0) throw new ProjectRefused(problems);
    const workflowProblems = await this.proposedWorkflowsProblems(project, proposed);
    if (workflowProblems.length > 0) throw new ProjectRefused(workflowProblems);
    return proposed;
  }

  /** Every reason the Proposal can't be applied now; empty when it can. */
  async proposedProblems(projectId: string, proposed: ProposedActions): Promise<string[]> {
    const project = await this.projects.find(projectId);
    if (!project) return [new ProjectNotFound(projectId).message];
    if (!isFeatureOn(project, "actions")) return [switchedOffWords("actions", project.name)];
    const problems = proposedActionsProblems(
      await this.repository.listOf(projectId),
      proposed,
      await this.contextOf(project),
    );
    return problems.length > 0 ? problems : this.proposedWorkflowsProblems(project, proposed);
  }

  /**
   * Applies the Proposal all or nothing, checked again against the Actions as they are held; each
   * value it changes is marked set by the Proposal. Refused (FeatureSwitchedOff) while the Project
   * has Actions switched off.
   */
  async changeAsProposed(
    projectId: string,
    proposed: ProposedActions,
    setter: { proposalId: string; agent: { roleKey: string; name: string } },
    by: SettingChangedBy,
  ): Promise<void> {
    const byProposal: ActionSetter = {
      by: "proposal",
      proposalId: setter.proposalId,
      agent: { roleKey: setter.agent.roleKey, name: setter.agent.name },
    };
    const project = await this.projects.read(projectId);
    ensureFeatureOn(project, "actions");
    const context = await this.contextOf(project);
    const toCheck = workflowsProposed(proposed);
    const listed = await this.workflowsFor(project, toCheck);
    let removed: string[] = [];
    await this.repository.update(
      projectId,
      async (current) => {
        const problems = proposedActionsProblems(current, proposed, context);
        if (problems.length > 0) throw new ProjectRefused(problems);
        const workflowProblems = workflowsProblems(project, toCheck, listed);
        if (workflowProblems.length > 0) throw new ProjectRefused(workflowProblems);
        const applied = appliedActions(current, proposed, byProposal);
        removed = removedKeys(current, applied);
        return applied;
      },
      (stored, saved) => ({
        setting: "actions",
        summary: actionsSummary(stored, saved),
        by,
      }),
    );
    await this.events.publish(new ProjectActionsChanged(projectId, removed));
  }

  private async contextOf(project: Project): Promise<ActionContext> {
    const commandKeys = project.commands.map(({ key }) => key);
    return {
      projectName: project.name,
      commandKeys,
      commandBeforeKeys:
        project.installCommand === "" ? commandKeys : [INSTALL_COMMAND_KEY, ...commandKeys],
      targetKeys: (await this.testTargets.listOf(project.id)).map(({ key }) => key),
      deviceIds: (await this.devices.of(project.id)).map(({ id }) => id),
      variables: project.environment.set,
    };
  }

  private async proposedWorkflowsProblems(
    project: Project,
    proposed: ProposedActions,
  ): Promise<string[]> {
    const toCheck = workflowsProposed(proposed);
    return workflowsProblems(project, toCheck, await this.workflowsFor(project, toCheck));
  }

  /** The Workflows the base branch declares a start by hand in; undefined when none is to check. */
  private async workflowsFor(
    project: Project,
    toCheck: readonly WorkflowToCheck[],
  ): Promise<ManualWorkflowList | undefined> {
    return toCheck.length === 0 ? undefined : this.workflows.list(project.id);
  }
}

/** The Workflow Actions of `edited` added, changed to a Workflow, or whose file or inputs changed. */
function workflowsChanged(
  stored: readonly ActionFields[],
  edited: readonly ActionFields[],
): WorkflowToCheck[] {
  return edited.flatMap((action) => {
    if (action.kind !== "workflow") return [];
    const before = stored.find(({ key }) => key === action.key);
    return before && sameSettings(before, action)
      ? []
      : [{ key: action.key, settings: action.settings }];
  });
}

/** The Workflow Actions a Proposal adds, changes to a Workflow, or whose file or inputs it changes. */
function workflowsProposed(proposed: ProposedActions): WorkflowToCheck[] {
  return proposed.actions.flatMap(({ from, to }) =>
    to !== null && to.kind === "workflow" && (from === null || !sameSettings(from, to))
      ? [{ key: to.key, settings: to.settings }]
      : [],
  );
}

/**
 * Why each Workflow's file doesn't declare a start by hand on the base branch, or its inputs don't
 * fit what it declares there, as Work › CI's Start a workflow checks them (spec §2.15, "Kinds").
 */
function workflowsProblems(
  project: Project,
  toCheck: readonly WorkflowToCheck[],
  listed: ManualWorkflowList | undefined,
): string[] {
  if (toCheck.length === 0 || listed === undefined) return [];
  const base = project.baseBranch;
  return toCheck.flatMap(({ key, settings }) => {
    const label = actionLabel(key);
    const file = settings.file;
    if (listed.problem !== null) {
      return [`${label}: ${file} can't be checked on ${base}: ${listed.problem}`];
    }
    const workflow = listed.workflows.find(
      (each) => workflowFileName(each.id) === workflowFileName(file),
    );
    if (workflow === undefined) {
      return [`${label}: ${file} doesn't declare a start by hand on ${base}.`];
    }
    const declared = new Set(workflow.inputs.map(({ name }) => name));
    const undeclared = Object.keys(settings.inputs)
      .filter((name) => !declared.has(name))
      .map((name) => `${label}: ${name} isn't an input ${file} declares on ${base}.`);
    const given = Object.fromEntries(
      Object.entries(settings.inputs).filter(([name]) => declared.has(name)),
    );
    try {
      inputsToSend(workflow, given);
      return undeclared;
    } catch (error) {
      if (!(error instanceof ProjectRefused)) throw error;
      return [...undeclared, ...error.reasons.map((reason) => `${label}: ${reason}`)];
    }
  });
}
