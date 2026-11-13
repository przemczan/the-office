import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OfficeSshKey } from "@the-office/contracts";
import { Button, Card, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { officeIdentityQueries } from "../../../api/office-identity.ts";
import { useCopyText } from "../../../shell/copy-text.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import { GitHubCard } from "./github-card.tsx";
import { HostsCards } from "./hosts-cards.tsx";
import { RegenerateSshKeyDialog } from "./regenerate-ssh-key-dialog.tsx";
import { maskedPublicKey } from "./ssh-key-words.ts";
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
  const queryClient = useQueryClient();
  const showToast = useToast();
  const copyText = useCopyText();
  const [shown, setShown] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const copy = (publicKey: string): void => {
    copyText(publicKey, {
      copied: "The Office ssh key's public half copied.",
      notCopied: "The key couldn't be copied. Select it and copy it instead.",
      // Shown, the key can be selected and copied by hand.
      onNotCopied: () => setShown(true),
    });
  };
  const regenerated = (newKey: OfficeSshKey): void => {
    queryClient.setQueryData(officeIdentityQueries.sshKey().queryKey, newKey);
    setShown(true);
    showToast(
      "The Office ssh key is new. Add its public half to each host The Office reaches over ssh.",
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
            <p
              className={shown ? "office-ssh-key" : "office-ssh-key office-ssh-key-masked"}
              aria-label="The Office ssh key's public half"
            >
              {shown ? sshKey.data.publicKey : maskedPublicKey(sshKey.data.publicKey)}
            </p>
            <div className="office-identity-row">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name={shown ? "eye-off" : "eye"} size={14} />}
                aria-pressed={shown}
                onClick={() => setShown(!shown)}
              >
                {shown ? "Hide" : "Show"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Icon name="copy" size={14} />}
                onClick={() => copy(sshKey.data.publicKey)}
              >
                Copy the public key
              </Button>
              <Button
                variant="danger-ghost"
                size="sm"
                iconLeft={<Icon name="refresh-cw" size={14} />}
                onClick={() => setRegenerating(true)}
              >
                Regenerate…
              </Button>
            </div>
          </>
        )}
        <SettingsProblem title="The Office ssh key can't be read" error={sshKey.error} />
      </div>
      {regenerating && (
        <RegenerateSshKeyDialog
          onRegenerated={regenerated}
          onClose={() => setRegenerating(false)}
        />
      )}
    </Card>
  );
}
