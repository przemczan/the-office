/** The Task a device is already connected to, which a refused connect names. */
export interface OtherTask {
  readonly id: string;
  readonly title: string;
}

/** A connect that breaks the rules of spec §2.13, with every reason in the UI's words. */
export class ConnectedDeviceRefused extends Error {
  constructor(
    readonly reasons: readonly string[],
    /** When the device is connected to another Task already. */
    readonly otherTask?: OtherTask,
  ) {
    super(reasons.join(" "));
    this.name = "ConnectedDeviceRefused";
  }
}

/** No Connected device, or no Task, by that id. */
export class ConnectedDeviceNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectedDeviceNotFound";
  }

  static device(id: string): ConnectedDeviceNotFound {
    return new ConnectedDeviceNotFound(`There is no Connected device "${id}".`);
  }

  static task(id: string): ConnectedDeviceNotFound {
    return new ConnectedDeviceNotFound(`There is no Task "${id}".`);
  }
}
