import { networkInterfaces } from "node:os";
import { Injectable } from "@nestjs/common";
import { WorkstationAddresses, type InterfaceAddress } from "../../ports/workstation-addresses.js";

/** The workstation's network addresses from `os.networkInterfaces()`, read on each ask. */
@Injectable()
export class NodeWorkstationAddresses extends WorkstationAddresses {
  list(): readonly InterfaceAddress[] {
    return Object.values(networkInterfaces()).flatMap((addresses) =>
      (addresses ?? []).map(({ address, family, internal }) => ({ address, family, internal })),
    );
  }
}
