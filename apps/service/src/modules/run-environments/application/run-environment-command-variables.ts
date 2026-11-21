import { Injectable, Logger } from "@nestjs/common";

/** A variable a check gets beside the Project's own, such as `OFFICE_CONNECTED_DEVICES`. */
export interface CommandVariable {
  readonly name: string;
  readonly value: string;
  /** Left out when the Project's own environment sets a variable of this name, as `ANDROID_SERIAL`. */
  readonly unlessProjectSets?: boolean;
}

/** What another module answers for a Task's check, read again as each check runs. */
export type CommandVariableSource = (taskId: string) => Promise<readonly CommandVariable[]>;

/**
 * The variables other modules give every check in a Task's run environment as it runs (spec §5.5,
 * "The Office device helper in a run environment"): appended to the Project's `set`, so each rides
 * its carrier, never the command line, the script or the container's own environment.
 */
@Injectable()
export class RunEnvironmentCommandVariables {
  private readonly logger = new Logger(RunEnvironmentCommandVariables.name);
  private readonly sources = new Set<CommandVariableSource>();

  /** Adds the source; the function answered takes it away again. */
  register(source: CommandVariableSource): () => void {
    this.sources.add(source);
    return () => this.sources.delete(source);
  }

  /** Every source's variables for the Task now; a source that fails gives none, logged. */
  async of(taskId: string): Promise<readonly CommandVariable[]> {
    const answers = await Promise.allSettled([...this.sources].map((source) => source(taskId)));
    return answers.flatMap((answer) => {
      if (answer.status === "fulfilled") return answer.value;
      this.logger.warn(`A variable of the Task ${taskId}'s check wasn't read.`, answer.reason);
      return [];
    });
  }
}
