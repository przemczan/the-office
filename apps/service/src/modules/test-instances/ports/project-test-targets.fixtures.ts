import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { OutputMask } from "../../projects/index.js";
import {
  ProjectTestTargets,
  type InstallSettings,
  type ListedTarget,
  type TargetEntryPoint,
  type TargetLaunch,
} from "./project-test-targets.js";

/** A Hosted test target as a test writes it, with its Secret variables' values. */
export interface TargetForTests {
  readonly key: string;
  readonly name: string;
  readonly kind: "hosted" | "build-to-install";
  readonly entryPoint: TargetEntryPoint;
  readonly port: number;
  readonly variables: readonly { readonly name: string; readonly value: string }[];
  readonly secretVariables: readonly { readonly name: string; readonly value: string | null }[];
}

/** A Project as a test makes it: its targets, its Run environment and its branch's files. */
export interface ProjectForTests {
  readonly id: string;
  runEnvironmentOn: boolean;
  targets: TargetForTests[];
  /** The branch tip's files, by their paths, which a checkout writes. */
  files: Record<string, string>;
  commit: string;
  /** The branch's tip as the repository has it, unfetched; `commit` when left out. */
  branchCommit?: string;
  /** Why the entry point isn't at the commit; none by default. */
  entryPointProblems: string[];
  /** The Project's own Secret variables, which no instance may get. */
  readonly installVariables: InstallSettings["installVariables"];
}

/** Projects' test targets and checkouts kept in memory; a checkout writes the files given. */
export class ProjectTestTargetsForTests extends ProjectTestTargets {
  readonly projects = new Map<string, ProjectForTests>();
  /** Each checkout asked for: the Project, the branch and the folder. */
  readonly checkouts: { projectId: string; branch: string; folder: string }[] = [];
  readonly removed: string[] = [];

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

  runEnvironmentOn(projectId: string): Promise<boolean> {
    return Promise.resolve(this.project(projectId).runEnvironmentOn);
  }

  launchOf(projectId: string, key: string): Promise<TargetLaunch> {
    const project = this.project(projectId);
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
      containerPort: target.kind === "hosted" ? target.port : undefined,
      runEnvironmentOn: project.runEnvironmentOn,
      variables: [...target.variables, ...secrets],
      secretsWithoutValue: target.secretVariables
        .filter(({ value }) => value === null)
        .map(({ name }) => name),
      mask: OutputMask.ofSecrets(secrets),
    });
  }

  entryPointProblemsAt(projectId: string): Promise<string[]> {
    return Promise.resolve([...this.project(projectId).entryPointProblems]);
  }

  async checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }> {
    const project = this.project(projectId);
    this.checkouts.push({ projectId, branch, folder });
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

  private project(projectId: string): ProjectForTests {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`No Project ${projectId}.`);
    return project;
  }
}
