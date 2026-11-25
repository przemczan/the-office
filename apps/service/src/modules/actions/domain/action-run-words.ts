import { runName, shortCommit, sinceWords, type ActionRun } from "./action-run.js";

/** A start in a test instance of The Office (spec §2.15, "In a test instance of The Office"). */
export const IN_A_TEST_INSTANCE =
  "A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't run Actions.";

/** A start while the fire alarm is on (spec §2.8, "Actions during the alarm"). */
export const FIRE_ALARM_ON = "The fire alarm is on.";

/** A Workflow run has no Stop (spec §2.15, "When a run stops"). */
export const WORKFLOW_HAS_NO_STOP =
  "A Workflow run is the code host's: The Office never cancels it. Use the CI tab's own controls.";

/** "<Action> is running already, started by <user> <when>." */
export function runningAlready(run: ActionRun, now: Date): string {
  return `${run.actionName} is running already, started by ${run.startedBy.name} ${sinceWords(run.startedAt, now)}.`;
}

/** "2 Actions are running: Build web on main, Lint on fix-login. Stop one to start another." */
export function actionsAtOnceFull(running: readonly ActionRun[]): string {
  const count =
    running.length === 1 ? "1 Action is running" : `${running.length} Actions are running`;
  return `${count}: ${running.map(runName).join(", ")}. Stop one to start another.`;
}

/** A Leaves the workstation Action started from anything but the base branch, naming it. */
export function notFromTheBaseBranch(
  actionName: string,
  baseBranch: string,
  chosen: string,
): string {
  return `${actionName} leaves the workstation, so it runs only from ${baseBranch}, not from ${chosen}.`;
}

/** A Leaves the workstation Action started without the commit its confirm step showed. */
export function noConfirmedCommit(actionName: string): string {
  return `${actionName} leaves the workstation: start it from its Run window, which shows the commit it will run.`;
}

/** "main moved to f00ba12 since you looked. Run it again to run that commit." */
export function movedSinceYouLooked(branch: string, tip: string): string {
  return `${branch} moved to ${shortCommit(tip)} since you looked. Run it again to run that commit.`;
}

/** A Workflow from a branch the remote lacks (spec §2.15, "What it runs from"). */
export function notOnTheRemote(branch: string): string {
  return `The remote has no branch ${branch}, and a Workflow runs on the code host: push ${branch} first.`;
}

export function noSuchTask(taskId: string): string {
  return `There is no Task "${taskId}".`;
}

export function taskOfAnotherProject(title: string): string {
  return `The Task «${title}» is of another Project.`;
}

export function taskHasNoBranch(title: string): string {
  return `The Task «${title}» has no branch of its own to run from.`;
}

export function taskEnded(title: string): string {
  return `The Task «${title}» is Done or Dropped; pick a branch instead.`;
}

export function noSuchInitiative(initiativeId: string): string {
  return `There is no Initiative "${initiativeId}".`;
}

export function initiativeNotActive(name: string): string {
  return `The Initiative «${name}» isn't active, so nothing runs from its branch.`;
}

export function initiativeHasNoBranch(name: string, projectName: string): string {
  return `The Initiative «${name}» has no branch in ${projectName}.`;
}

/** The run fails at its start when a command it names is gone (spec §2.15, "Kinds"). */
export function commandsGone(keys: readonly string[]): string {
  return keys.length === 1
    ? `The Project's command ${keys[0]} is gone; pick the commands again in the Project's Actions.`
    : `The Project's commands ${keys.join(", ")} are gone; pick the commands again in the Project's Actions.`;
}

/** The run fails at its start when its test target is gone. */
export function targetGone(key: string): string {
  return `The Project's test target ${key} is gone; pick the target again in the Project's Actions.`;
}

/** Failed at the time limit (spec §2.15, "When a run stops"). */
export function ranOutOfTime(minutes: number): string {
  return `The run ran out of its ${minutes} minutes.`;
}

/** Failed by a non-zero exit: the command's own, or a command's before it. */
export function exitCodeWords(name: string, exitCode: number, isTheCommand: boolean): string {
  return isTheCommand
    ? `The command ended with exit code ${exitCode}.`
    : `${name}, run before the command, ended with exit code ${exitCode}.`;
}

/** Failed by a command the shell couldn't run at all. */
export function couldNotRun(name: string): string {
  return `${name} couldn't run.`;
}

/** The code host didn't show the CI run in time (spec §2.15, "States"). */
export function didNotShow(hostName: string): string {
  return `${hostName} didn't show the run in 60 seconds; it may still run there.`;
}

/** An Action naming a device started with Run environment Off (spec §2.15, "Where a run runs"). */
export function deviceNeedsRunEnvironmentOn(actionName: string, deviceName: string): string {
  return `${actionName} holds ${deviceName}, which needs Run environment On.`;
}

/** The run fails at its start when the device it names is no longer the Project's. */
export function deviceGone(projectDeviceId: string): string {
  return `The Project's device ${projectDeviceId} is gone; pick the device again in the Project's Actions.`;
}

/** "Pixel is in use by Install on my phone on main.", as Devices names a run holding it (spec §2.13). */
export function deviceInUseBy(deviceName: string, holderName: string): string {
  return `${deviceName} is in use by ${holderName}.`;
}

/** Failed when the run's hold ended from outside: "Pixel was let go of: Run environment turned Off." */
export function deviceLetGoOf(deviceName: string, why: string): string {
  return `${deviceName} was let go of: ${why.replace(/\.$/, "")}.`;
}
