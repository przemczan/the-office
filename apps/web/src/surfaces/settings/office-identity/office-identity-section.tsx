import { useQuery } from "@tanstack/react-query";
import { Button, Card, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { officeIdentityQueries } from "../../../api/office-identity.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { GitHubCard } from "./github-card.tsx";
import { HostsCards } from "./hosts-cards.tsx";
import "./office-identity.css";

/**
 * Settings › Office identity (spec §5.5 Defaults): the only credentials The Office's git uses,
 * Sign in with GitHub and the Office ssh key, with the hosts its ssh trusts.
 */
export function OfficeIdentitySection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Office identity" });
  return (
    <>
      <p className="settings-note">
        Every git command The Office runs uses only these, never your own credentials: Sign in with
        GitHub for GitHub over https, the Office ssh key for ssh remotes on any host. Other hosts
        over https are reached anonymously, so public repositories only.
      </p>
      <GitHubCard />
      <SshKeyCard />
      <HostsCards />
    </>
  );
}

function SshKeyCard(): ReactNode {
  const sshKey = useQuery(officeIdentityQueries.sshKey());
  const showToast = useToast();
  const copy = (publicKey: string): void => {
    navigator.clipboard.writeText(publicKey).then(
      () => showToast("The Office ssh key's public half copied."),
      () => showToast("The key couldn't be copied. Select it and copy it instead."),
    );
  };
  return (
    <Card title={<SettingsCardTitle icon="key-round">Office ssh key</SettingsCardTitle>}>
      <div className="office-identity-card-body">
        <p className="settings-note">
          The Office reaches ssh remotes with this key alone. Add its public half to each host that
          needs it: on GitHub, under your account's Settings › SSH and GPG keys; elsewhere, wherever
          the host takes ssh keys.
        </p>
        {sshKey.data && (
          <>
            <p className="office-ssh-key" aria-label="The Office ssh key's public half">
              {sshKey.data.publicKey}
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name="copy" size={14} />}
                onClick={() => copy(sshKey.data.publicKey)}
              >
                Copy the public key
              </Button>
            </div>
          </>
        )}
        <SettingsProblem title="The Office ssh key can't be read" error={sshKey.error} />
      </div>
    </Card>
  );
}
