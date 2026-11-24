import { Injectable, Logger } from "@nestjs/common";
import { DEFINITION_FOLDER, type DefinitionFile } from "../domain/run-environment-definition.js";
import { RepositoryFiles } from "../ports/repository-files.js";
import { writeDefinitionIn, type DefinitionWriting } from "./definition-files.js";

/**
 * How writing and committing the definition went: the files written, the checks' service and the
 * Task's branch's commit holding them, or every problem, with nothing written or committed.
 */
export type DefinitionCommit =
  | { readonly written: false; readonly problems: readonly string[] }
  | {
      readonly written: true;
      readonly service: string;
      readonly paths: readonly string[];
      readonly commit: string;
    };

/**
 * The Run environment definition as Agents write it, through The Office's tool (spec §5.5, §6):
 * checked as it would be read, and written into the worktree only when valid.
 */
@Injectable()
export class RunEnvironmentDefinitions {
  private readonly logger = new Logger(RunEnvironmentDefinitions.name);

  constructor(private readonly files: RepositoryFiles) {}

  write(worktree: string, files: readonly DefinitionFile[]): Promise<DefinitionWriting> {
    return writeDefinitionIn(worktree, files);
  }

  /**
   * Writes the definition as `write` does, then commits only `.devcontainer/` on the Task's branch
   * with `message`: nothing else staged or changed in the worktree goes into the commit or changes.
   * Refused, with nothing written, while `.devcontainer/` has changes not committed yet, which the
   * commit would otherwise carry as the Agent's. When the commit fails, `.devcontainer/` is put back
   * as committed, so the files written don't stand in the way of the next call, and it throws.
   */
  async writeAndCommit(
    worktree: string,
    files: readonly DefinitionFile[],
    message: string,
  ): Promise<DefinitionCommit> {
    const uncommitted = await this.files.uncommittedPathsUnder(worktree, DEFINITION_FOLDER);
    if (uncommitted.length > 0) {
      return {
        written: false,
        problems: [
          `${DEFINITION_FOLDER}/ has changes not committed yet that this write didn't make (${uncommitted.join(", ")}); the write is refused until the Stage commits them or they are discarded.`,
        ],
      };
    }
    const writing = await writeDefinitionIn(worktree, files);
    if (!writing.written) return writing;
    let commit: string;
    try {
      commit = await this.files.commitFolder(worktree, DEFINITION_FOLDER, message);
    } catch (error) {
      await this.files.restoreFolder(worktree, DEFINITION_FOLDER).catch((restoring: unknown) => {
        this.logger.error(
          `${DEFINITION_FOLDER}/ in ${worktree} wasn't put back as committed.`,
          restoring,
        );
      });
      throw error;
    }
    return { written: true, service: writing.service, paths: writing.paths, commit };
  }
}
