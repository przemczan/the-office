import type { Logger } from "@nestjs/common";
import { readdir, rm } from "node:fs/promises";
import { officeLabels, type Labels } from "../domain/run-environment.js";
import type { ContainerRuntime, Removal } from "../ports/container-runtime.js";

/** One of The Office's compose projects, as it is removed. */
export interface OfficeComposeProject {
  readonly name: string;
  /** What still carries every one of them after `down` is removed by them. */
  readonly labels: Labels;
  /** Its files in the Office data directory. */
  readonly folder: string;
  readonly removal?: Removal;
  /** Names it in the log, such as "The Action run <id>". */
  readonly what: string;
}

/**
 * How The Office removes its compose projects, and finds those a last run left (spec §5.5,
 * "Lifecycle"): what a Task's run environment, a Hosted Test instance, an Action run's environment
 * and a pairing environment share, so each meets a stuck runtime the same way.
 */
export class ComposeProjectLifecycle {
  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly instance: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Takes the project down, then removes whatever still carries its labels, then its files: a
   * `down` that fails is only logged, as the labels find what it left, and the files go even when
   * the removal by label fails, which then throws, something of the project maybe left.
   */
  async remove(project: OfficeComposeProject): Promise<void> {
    try {
      await this.runtime.down(project.name, project.removal);
    } catch (error) {
      this.logger.warn(`${project.what} didn't come down.`, error);
    }
    const byLabel = await this.runtime.removeByLabel(project.labels).then(
      () => undefined,
      (error: unknown) => ({ error }),
    );
    await rm(project.folder, { recursive: true, force: true });
    if (byLabel !== undefined) throw byLabel.error;
  }

  /** The ids `label` gives this Office's resources the runtime holds, each once. */
  async labelled(label: string): Promise<Set<string>> {
    const resources = await this.runtime.listByLabel(officeLabels(this.instance));
    const ids = new Set(resources.map(({ labels }) => labels[label] ?? ""));
    ids.delete("");
    return ids;
  }

  /** The names of the folders under `folder`, each a compose project's files; none without it. */
  async withFiles(folder: string): Promise<readonly string[]> {
    return readdir(folder).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  }

  /**
   * Runs the sweep's step for each id in turn, a failure logged under `what` and never keeping the
   * others from theirs.
   */
  async eachOf(
    ids: Iterable<string>,
    what: (id: string) => string,
    step: (id: string) => Promise<void>,
  ): Promise<void> {
    for (const id of ids) {
      try {
        await step(id);
      } catch (error) {
        this.logger.warn(`${what(id)} wasn't swept.`, error);
      }
    }
  }
}
