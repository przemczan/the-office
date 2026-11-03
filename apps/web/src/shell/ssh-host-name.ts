import { SSH_PORT } from "@the-office/contracts";

/** An ssh host as a remote's URL names it: ssh's own port is left out. */
export function sshHostName({
  host,
  port,
}: {
  readonly host: string;
  readonly port: number;
}): string {
  return port === SSH_PORT ? host : `${host}:${port}`;
}
