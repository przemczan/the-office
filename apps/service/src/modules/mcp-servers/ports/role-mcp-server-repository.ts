/** One server assigned to one Role. */
export interface RoleMcpServer {
  readonly roleKey: string;
  readonly serverName: string;
}

/** Where the servers' Roles are kept. */
export abstract class RoleMcpServerRepository {
  /** Every assignment, by Role key, then server name. */
  abstract list(): Promise<readonly RoleMcpServer[]>;

  /** Assigns the server to exactly these Roles. */
  abstract replaceRolesOf(serverName: string, roleKeys: readonly string[]): Promise<void>;
}
