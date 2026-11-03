import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  hostKeyConfirmationSchema,
  sshHostSchema,
  type HostKeyConfirmation,
  type KnownHosts,
  type OfficeSshKey as OfficeSshKeyResponse,
  type ScannedHost,
  type SshHost,
} from "@the-office/contracts";
import { ContractPipe } from "../http/contract-pipe.js";
import { HostKeyRefused, OfficeKnownHosts } from "./office-known-hosts.js";
import { OfficeSshKey } from "./office-ssh-key.js";

/**
 * The Office ssh key and The Office's own known hosts, as Settings › Office identity shows them
 * (spec §5.5 Defaults, the Office identity). The private half of the key never leaves the service.
 */
@Controller("office-identity")
export class OfficeIdentityController {
  constructor(
    private readonly sshKey: OfficeSshKey,
    private readonly knownHosts: OfficeKnownHosts,
  ) {}

  /** The key's public half, made first if The Office has none yet. */
  @Get("ssh-key")
  async publicKey(): Promise<OfficeSshKeyResponse> {
    return { publicKey: await this.sshKey.publicKey() };
  }

  /** A new key in place of the current one, which a failure keeps; answers the new public half. */
  @Post("ssh-key/regenerate")
  @HttpCode(200)
  async regenerate(): Promise<OfficeSshKeyResponse> {
    try {
      return { publicKey: await this.sshKey.regenerate() };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException({ message: reason, reasons: [reason] });
    }
  }

  @Get("known-hosts")
  knownHostsList(): Promise<KnownHosts> {
    return this.knownHostsNow();
  }

  /** The keys the host presents now, for the user to compare with the host's own fingerprints. */
  @Post("known-hosts/scan")
  @HttpCode(200)
  async scan(@Body(new ContractPipe(sshHostSchema)) { host, port }: SshHost): Promise<ScannedHost> {
    try {
      const keys = await this.knownHosts.scan(host, port);
      return { host, port, keys: keys.map(({ type, fingerprint }) => ({ type, fingerprint })) };
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }

  /** Trusts the host's key the user confirmed; refused when the host no longer shows it. */
  @Post("known-hosts")
  @HttpCode(200)
  async confirm(
    @Body(new ContractPipe(hostKeyConfirmationSchema))
    { host, port, fingerprint }: HostKeyConfirmation,
  ): Promise<KnownHosts> {
    try {
      await this.knownHosts.confirm(host, port, fingerprint);
    } catch (error) {
      if (error instanceof HostKeyRefused) {
        throw new UnprocessableEntityException({
          message: error.message,
          reasons: [error.message],
        });
      }
      throw error;
    }
    return this.knownHostsNow();
  }

  private async knownHostsNow(): Promise<KnownHosts> {
    const [trusted, unconfirmed] = await Promise.all([
      this.knownHosts.trusted(),
      this.knownHosts.unconfirmed(),
    ]);
    return {
      trusted: trusted.map(({ host, port, keys }) => ({
        host,
        port,
        fingerprints: keys.map((key) => key.fingerprint),
        fromGitHub: this.knownHosts.isGitHub(host, port),
      })),
      unconfirmed: unconfirmed.map(({ host, port }) => ({ host, port })),
    };
  }
}
