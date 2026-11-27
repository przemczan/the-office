/**
 * Where the running Office can be reached, as it is configured: its API's port and its database's
 * URL. The engine's hook refuses a command naming them (spec 6 › No bypass). Modules inject it as
 * optional, so a test's app without it refuses nothing of the kind.
 */
export class OfficeReachConfig {
  constructor(
    readonly apiPort: number,
    readonly databaseUrl: string,
  ) {}
}
