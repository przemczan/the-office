import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { OfficeAddresses } from "./office-addresses.js";
import { SignedInRequests } from "./signed-in-requests.js";

export interface RequestAccessOptions {
  /** The public address as an origin, or undefined when The Office has none. */
  readonly publicAddress: string | undefined;
  /** The modules that provide `signedInRequests`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly signedInRequests: Type<SignedInRequests>;
}

/**
 * Binds who may reach The Office in the composition root: the addresses it answers at and the
 * signed-in devices it answers. Global, so `configureHttp` and the WebSocket find them.
 */
@Module({})
export class RequestAccessModule {
  static register({
    publicAddress,
    imports,
    signedInRequests,
  }: RequestAccessOptions): DynamicModule {
    return {
      module: RequestAccessModule,
      global: true,
      imports,
      providers: [
        { provide: OfficeAddresses, useValue: new OfficeAddresses(publicAddress) },
        { provide: SignedInRequests, useExisting: signedInRequests },
      ],
      exports: [OfficeAddresses, SignedInRequests],
    };
  }
}
