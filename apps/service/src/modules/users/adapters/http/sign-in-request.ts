import type { IncomingMessage } from "node:http";
import type { RequestAddress } from "../../../../platform/http/local-requests.js";
import type { AddressKind } from "../../domain/address-kind.js";
import type { SignInRequest } from "../../domain/signed-in-device.js";

const ADDRESS_KINDS: Readonly<Record<RequestAddress["kind"], AddressKind>> = {
  localhost: "localhost",
  "loopback-ip": "loopback-ip",
  "local-network-ip": "local-network-ip",
  public: "public",
};

/** The domain's kind of the address the platform told. */
export function addressKindOf(address: RequestAddress): AddressKind {
  return ADDRESS_KINDS[address.kind];
}

/** What a sign-in request tells of the device it came from. */
export function signInRequestOf(request: IncomingMessage, address: RequestAddress): SignInRequest {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: userAgent === undefined || userAgent === "" ? undefined : userAgent,
    addressKind: addressKindOf(address),
  };
}
