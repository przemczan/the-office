import { Injectable } from "@nestjs/common";
import type { DefinitionFile } from "../domain/run-environment-definition.js";
import { writeDefinitionIn, type DefinitionWriting } from "./definition-files.js";

/**
 * The Run environment definition as Agents write it, through The Office's tool (spec §5.5, §6):
 * checked as it would be read, and written into the worktree only when valid.
 */
@Injectable()
export class RunEnvironmentDefinitions {
  write(worktree: string, files: readonly DefinitionFile[]): Promise<DefinitionWriting> {
    return writeDefinitionIn(worktree, files);
  }
}
