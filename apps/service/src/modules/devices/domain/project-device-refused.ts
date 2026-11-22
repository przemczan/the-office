/** What holds a Project device, or last held it: a Task it is lent to. */
export interface ProjectDeviceHolder {
  readonly kind: "task";
  readonly taskId: string;
  readonly title: string;
}

/**
 * A change to a Project device, or a lend, that breaks the rules of spec §2.13, with every reason
 * in the UI's words; `holder` when another environment holds the device.
 */
export class ProjectDeviceRefused extends Error {
  constructor(
    readonly reasons: readonly string[],
    readonly holder?: ProjectDeviceHolder,
  ) {
    super(reasons.join(" "));
    this.name = "ProjectDeviceRefused";
  }
}

/** No Project device by that id. */
export class ProjectDeviceNotFound extends Error {
  constructor(id: string) {
    super(`There is no Project device "${id}".`);
    this.name = "ProjectDeviceNotFound";
  }
}
