/** How to end a process together with every process it started, which differs by system. */
export interface ProcessTrees {
  /**
   * Node's spawn option of the same name, for a process whose tree may have to be ended: on Linux
   * it puts the process in a group of its own, which `end` signals as a whole.
   */
  readonly detached: boolean;
  /**
   * Ends the process and every process it started, returning once they have ended (an ended
   * process its parent hasn't collected yet counts); a process already gone is no error.
   */
  end(processId: number): Promise<void>;
  /**
   * Ends what a process started with `detached` left running after it ended by itself: on Linux
   * its process group, on Windows its children with every process they started. A process that
   * left nothing is no error. Returns once they have ended, as `end` does.
   */
  endLeftovers(processId: number): Promise<void>;
  /**
   * Ends every process a running process started, and those they started, leaving the process
   * itself running: for a program The Office doesn't spawn itself, such as the Copilot CLI runtime
   * the SDK starts, whose commands run in groups and sessions of their own and outlive it. On
   * Linux each one found by its parent, with the group it leads; on Windows its children with every
   * process they started. Returns once they have ended, as `end` does.
   */
  endDescendants(processId: number): Promise<void>;
}
