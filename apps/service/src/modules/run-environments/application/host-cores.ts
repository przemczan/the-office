/**
 * This computer's cores, which the Automatic CPU limit follows: read once as the module is
 * composed (`os.availableParallelism()`), or given by a test so none depends on its machine.
 */
export class HostCores {
  constructor(readonly count: number) {}
}
