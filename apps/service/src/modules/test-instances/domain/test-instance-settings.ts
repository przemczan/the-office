/** The Test instances limits (spec §2.12, Defaults), Office-wide. */
export interface TestInstanceSettings {
  /** How many instances may be Building or Running together. */
  readonly testInstancesAtOnce: number;
  /** Minutes a Running Hosted instance may go with no request before it stops. */
  readonly idleMinutes: number;
  /** The Proxy ports, first to last, both given out. */
  readonly firstProxyPort: number;
  readonly lastProxyPort: number;
}

export const DEFAULT_SETTINGS: TestInstanceSettings = {
  testInstancesAtOnce: 2,
  idleMinutes: 30,
  firstProxyPort: 4400,
  lastProxyPort: 4419,
};

/**
 * Why the settings can't be kept beyond their bounds, which the contract checks: a Proxy port range
 * holding The Office's own port, which the proxy could never listen on. Each names its field.
 */
export function settingsProblems(settings: TestInstanceSettings, officePort: number): string[] {
  if (officePort < settings.firstProxyPort || officePort > settings.lastProxyPort) return [];
  return [`firstProxyPort: The Proxy ports can't hold The Office's own port, ${officePort}.`];
}

/** The lowest port of the range not in `held`; undefined when every one is. */
export function freeProxyPort(
  settings: Pick<TestInstanceSettings, "firstProxyPort" | "lastProxyPort">,
  held: ReadonlySet<number>,
): number | undefined {
  for (let port = settings.firstProxyPort; port <= settings.lastProxyPort; port++) {
    if (!held.has(port)) return port;
  }
  return undefined;
}

export function everyPortInUse(
  settings: Pick<TestInstanceSettings, "firstProxyPort" | "lastProxyPort">,
): string {
  return (
    `Every Proxy port is in use (${settings.firstProxyPort}–${settings.lastProxyPort}). ` +
    "Stop a test instance, or give the Proxy ports more room in Settings › Office limits."
  );
}

/** An active instance as the limit's refusal names it: by its Initiative, else by its branch. */
export type ActiveInstanceName =
  | { readonly targetName: string; readonly initiativeName: string }
  | { readonly targetName: string; readonly branch: string };

/** Why one more instance can't launch now; undefined while there is room (Building counts). */
export function overTheLimit(
  active: readonly ActiveInstanceName[],
  testInstancesAtOnce: number,
): string | undefined {
  if (active.length < testInstancesAtOnce) return undefined;
  const named = active
    .map((instance) =>
      "initiativeName" in instance
        ? `${instance.targetName} in ${instance.initiativeName}`
        : `${instance.targetName} on ${instance.branch}`,
    )
    .join(", ");
  const count = active.length === 1 ? "1 test instance is" : `${active.length} test instances are`;
  return `${count} building or running: ${named}. Stop one to launch another.`;
}
