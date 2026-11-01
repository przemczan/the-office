import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SSH_PORT,
  type HostKey,
  type TrustedHost,
  type UnconfirmedHost,
} from "@the-office/contracts";
import { Badge, Button, Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  confirmFingerprint,
  officeIdentityQueries,
  scanHost,
} from "../../../api/office-identity.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

/** The hosts The Office's ssh trusts, and those refused until the user confirms a fingerprint. */
export function HostsCards(): ReactNode {
  const knownHosts = useQuery(officeIdentityQueries.knownHosts());
  return (
    <>
      <Card title={<SettingsCardTitle icon="shield-alert">Unconfirmed hosts</SettingsCardTitle>}>
        <div className="office-identity-card-body">
          <p className="settings-note">
            ssh hosts an Office git command was refused for because their key isn&apos;t confirmed
            yet. Scan one, compare a fingerprint with the one its owner publishes, and confirm it
            only when they match.
          </p>
          {knownHosts.data &&
            (knownHosts.data.unconfirmed.length === 0 ? (
              <p className="settings-note">No Unconfirmed host.</p>
            ) : (
              <ul className="known-hosts">
                {knownHosts.data.unconfirmed.map((host) => (
                  <UnconfirmedHostItem key={hostName(host)} host={host} />
                ))}
              </ul>
            ))}
        </div>
      </Card>
      <Card title={<SettingsCardTitle icon="shield-check">Trusted hosts</SettingsCardTitle>}>
        <div className="office-identity-card-body">
          <p className="settings-note">
            The Office&apos;s ssh accepts only these keys. GitHub&apos;s come from GitHub&apos;s
            published list the first time an ssh remote on GitHub is reached.
          </p>
          {knownHosts.data &&
            (knownHosts.data.trusted.length === 0 ? (
              <p className="settings-note">No Trusted host yet.</p>
            ) : (
              <ul className="known-hosts">
                {knownHosts.data.trusted.map((host) => (
                  <TrustedHostItem key={hostName(host)} host={host} />
                ))}
              </ul>
            ))}
          <SettingsProblem title="The hosts can't be read" error={knownHosts.error} />
        </div>
      </Card>
    </>
  );
}

function TrustedHostItem({ host }: { readonly host: TrustedHost }): ReactNode {
  const name = hostName(host);
  return (
    <li className="known-host" aria-label={name}>
      <div className="office-identity-row">
        <span className="known-host-name">{name}</span>
        {host.fromGitHub && <Badge tone="info">From GitHub</Badge>}
      </div>
      <ul className="known-host-keys" aria-label={`Fingerprints of ${name}`}>
        {host.fingerprints.map((fingerprint) => (
          <li key={fingerprint} className="known-host-key">
            {fingerprint}
          </li>
        ))}
      </ul>
    </li>
  );
}

function UnconfirmedHostItem({ host }: { readonly host: UnconfirmedHost }): ReactNode {
  const name = hostName(host);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const scanning = useMutation({ mutationFn: () => scanHost(host) });
  const confirming = useMutation({
    mutationFn: (key: HostKey) => confirmFingerprint({ ...host, fingerprint: key.fingerprint }),
    onSuccess: (knownHosts) => {
      queryClient.setQueryData(officeIdentityQueries.knownHosts().queryKey, knownHosts);
      showToast(`${name} is trusted now.`);
    },
  });
  const keys = scanning.data?.keys;
  return (
    <li className="known-host" aria-label={name}>
      <div className="office-identity-row">
        <span className="known-host-name">{name}</span>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="scan-search" size={14} />}
          loading={scanning.isPending}
          onClick={() => scanning.mutate()}
        >
          {scanning.data ? "Scan again" : "Scan"}
        </Button>
      </div>
      {keys?.length === 0 && (
        <p className="settings-note">Nothing answered on its ssh port, so it shows no key.</p>
      )}
      {keys && keys.length > 0 && (
        <ul className="known-host-keys" aria-label={`Keys of ${name}`}>
          {keys.map((key) => (
            <li key={key.fingerprint} className="known-host-key">
              <span className="known-host-key-type">{key.type}</span>
              <span>{key.fingerprint}</span>
              <Button
                variant="ghost"
                size="sm"
                loading={confirming.isPending && confirming.variables === key}
                disabled={confirming.isPending}
                onClick={() => confirming.mutate(key)}
              >
                Confirm fingerprint
              </Button>
            </li>
          ))}
        </ul>
      )}
      {scanning.error && <RefusalAlert title={`${name} can't be scanned`} error={scanning.error} />}
      {confirming.error && (
        <RefusalAlert title={`${name} isn't trusted`} error={confirming.error} />
      )}
    </li>
  );
}

/** As ssh names the host: bare on its own port, else `host:port`. */
function hostName({ host, port }: { readonly host: string; readonly port: number }): string {
  return port === SSH_PORT ? host : `${host}:${port}`;
}
