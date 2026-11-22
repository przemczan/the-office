import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OutputMask } from "../../projects/index.js";
import {
  ProjectTestTargets,
  type InstallSettings,
  type CommandBefore,
  type ListedTarget,
  type TargetLaunch,
  type WorkstationBuild,
  type WorkstationBuildEnd,
} from "./project-test-targets.js";
import type { TargetEntryPoint } from "../domain/entry-point.js";
import { TestInstanceRefused } from "../domain/test-instance-refused.js";

/** A Hosted or Build to install test target as a test writes it, with its Secret variables' values. */
export interface TargetForTests {
  readonly key: string;
  readonly name: string;
  readonly kind: "hosted" | "build-to-install" | "install-on-a-device";
  readonly entryPoint: TargetEntryPoint;
  /** A Hosted target's port. */
  readonly port?: number;
  /** A Build to install target's output patterns. */
  readonly outputPatterns?: readonly string[];
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  readonly secretVariables: readonly { readonly name: string; readonly value: string | null }[];
  /** The Project's commands run before the entry point; none by default. */
  readonly commandsBefore?: readonly CommandBefore[];
  /** The keys of commands before the entry point the Project no longer has; none by default. */
  readonly missingCommands?: readonly string[];
  /** A Hosted target's port variable; PORT, contracts' `DEFAULT_PORT_VARIABLE`, by default. */
  readonly portVariable?: string;
  /** The target's own Memory per service in MB; the Office-wide value by default. */
  readonly memoryMegabytes?: number;
}

/** A Project as a test makes it: its targets, its Run environment and its branch's files. */
export interface ProjectForTests {
  readonly id: string;
  runEnvironmentOn: boolean;
  /** Whether Test targets are switched on; on when left out. */
  testTargetsOn?: boolean;
  targets: TargetForTests[];
  /** The branch tip's files, by their paths, which a checkout writes. */
  files: Record<string, string>;
  commit: string;
  /** The branch's tip as the repository has it, unfetched; `commit` when left out. */
  branchCommit?: string;
  /** Why the entry point isn't at the commit; none by default. */
  entryPointProblems: string[];
  /** Branches neither the repository nor its remote has, which a checkout fails on. */
  missingBranches?: string[];
  /** The Project's own Secret variables, which no instance may get. */
  readonly installVariables: InstallSettings["installVariables"];
}

/** Projects' test targets and checkouts kept in memory; a checkout writes the files given. */
export class ProjectTestTargetsForTests extends ProjectTestTargets {
  readonly projects = new Map<string, ProjectForTests>();
  /** Each checkout asked for: the Project, the branch and the folder. */
  readonly checkouts: { projectId: string; branch: string; folder: string }[] = [];
  readonly removed: string[] = [];
  /** Each workstation build asked for. */
  readonly builds: WorkstationBuild[] = [];
  /** How a workstation build runs: by default it exits 0 having made nothing. */
  onBuild: (build: WorkstationBuild) => Promise<WorkstationBuildEnd> = () =>
    Promise.resolve({ exitCode: 0, endedBy: undefined });

  put(project: ProjectForTests): void {
    this.projects.set(project.id, project);
  }

  targetsOf(projectId: string): Promise<readonly ListedTarget[]> {
    return Promise.resolve(
      this.project(projectId).targets.map(({ key, name, kind, entryPoint }) => ({
        key,
        name,
        kind,
        entryPoint,
      })),
    );
  }

  testTargetsOn(projectId: string): Promise<boolean> {
    return Promise.resolve(
      this.projects.get(projectId)?.testTargetsOn ?? this.projects.has(projectId),
    );
  }

  runEnvironmentOn(projectId: string): Promise<boolean> {
    return Promise.resolve(this.project(projectId).runEnvironmentOn);
  }

  /** Refused as Projects' refusal comes out of the adapter while Test targets are off. */
  launchOf(projectId: string, key: string): Promise<TargetLaunch> {
    const project = this.project(projectId);
    if (project.testTargetsOn === false) {
      return Promise.reject(
        new TestInstanceRefused([`Test targets are switched off for «${projectId}».`]),
      );
    }
    const target = project.targets.find((each) => each.key === key);
    if (!target) return Promise.reject(new Error(`No test target ${key}.`));
    const secrets = target.secretVariables.flatMap(({ name, value }) =>
      value === null ? [] : [{ name, value }],
    );
    return Promise.resolve({
      key: target.key,
      name: target.name,
      kind: target.kind,
      entryPoint: target.entryPoint,
      containerPort: target.kind === "build-to-install" ? undefined : target.port,
      runEnvironmentOn: project.runEnvironmentOn,
      outputPatterns: target.kind === "build-to-install" ? (target.outputPatterns ?? []) : [],
      variables: [
        ...target.variables.map(({ name, value }) => ({ name, value, secret: false })),
        ...secrets.map(({ name, value }) => ({ name, value, secret: true })),
      ],
      secretsWithoutValue: target.secretVariables
        .filter(({ value }) => value === null)
        .map(({ name }) => name),
      commandsBefore: target.commandsBefore ?? [],
      missingCommands: target.missingCommands ?? [],
      portVariable: target.kind === "hosted" ? (target.portVariable ?? "PORT") : undefined,
      memoryMegabytes: target.memoryMegabytes,
      mask: OutputMask.ofSecrets(secrets),
    });
  }

  entryPointProblemsAt(projectId: string): Promise<string[]> {
    return Promise.resolve([...this.project(projectId).entryPointProblems]);
  }

  async checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }> {
    const project = this.project(projectId);
    this.checkouts.push({ projectId, branch, folder });
    if (project.missingBranches?.includes(branch)) {
      throw new Error(`The branch ${branch} isn't in ${projectId} or on its remote.`);
    }
    await rm(folder, { recursive: true, force: true });
    for (const [path, text] of Object.entries(project.files)) {
      await mkdir(dirname(join(folder, path)), { recursive: true });
      await writeFile(join(folder, path), text);
    }
    return { commit: project.commit };
  }

  branchCommitOf(projectId: string): Promise<string | undefined> {
    const project = this.project(projectId);
    return Promise.resolve(project.branchCommit ?? project.commit);
  }

  async removeCheckout(folder: string): Promise<void> {
    this.removed.push(folder);
    // Best effort, as Projects' is: a checkout still being written is removed by its launch.
    await rm(folder, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
  }

  installSettingsOf(projectId: string): Promise<InstallSettings> {
    return Promise.resolve({
      installCommand: "npm ci",
      installInputs: ["package-lock.json"],
      installVariables: this.project(projectId).installVariables,
    });
  }

  runBuild(build: WorkstationBuild): Promise<WorkstationBuildEnd> {
    this.builds.push(build);
    return this.onBuild(build);
  }

  private project(projectId: string): ProjectForTests {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`No Project ${projectId}.`);
    return project;
  }
}
