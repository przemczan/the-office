/** One address a network interface of the workstation has, as `os.networkInterfaces()` lists it. */
export interface InterfaceAddress {
  readonly address: string;
  readonly family: "IPv4" | "IPv6";
  readonly internal: boolean;
}

/**
 * The workstation's network addresses as they are now, read on each ask, so a network joined or
 * left since The Office started is offered as it is.
 */
export abstract class WorkstationAddresses {
  abstract list(): readonly InterfaceAddress[];
}
