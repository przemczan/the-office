import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { setUpAuthenticator, userQueries } from "../../api/users.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { AccountCardTitle } from "./account-card-title.tsx";
import {
  NewRecoveryCodesDialog,
  SetUpAuthenticatorDialog,
  TurnOffAuthenticatorDialog,
} from "./authenticator-dialogs.tsx";

type OpenDialog = "turn-off" | "new-recovery-codes" | undefined;

/**
 * Account › Authenticator (spec §2.10): off, with Set up; or on, with how many recovery codes are
 * left, New recovery codes and Turn off, each asking for a code.
 */
export function AuthenticatorSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Authenticator" });
  const account = useQuery(userQueries.account());
  const authenticator = account.data?.authenticator;
  const [open, setOpen] = useState<OpenDialog>();
  const settingUp = useMutation({ mutationFn: setUpAuthenticator });
  return (
    <div className="account-cards">
      <Card
        title={
          <AccountCardTitle icon="smartphone">
            Authenticator
            {authenticator?.state === "on" && (
              <Badge tone="success" size="sm">
                On
              </Badge>
            )}
          </AccountCardTitle>
        }
        subtitle="After your password, Continue with GitHub or Continue with Google, The Office asks for a code from an app on your phone. A passkey needs none."
      >
        {account.error && <RefusalAlert title="The account can't be read" error={account.error} />}
        {settingUp.error && (
          <Alert tone="danger" title="The authenticator can't be set up">
            {settingUp.error.message}
          </Alert>
        )}
        {authenticator?.state === "off" && (
          <div className="account-actions">
            <span className="account-words">Off: your password alone signs you in.</span>
            <Button
              variant="primary"
              size="sm"
              loading={settingUp.isPending}
              onClick={() => settingUp.mutate()}
            >
              Set up the authenticator
            </Button>
          </div>
        )}
        {authenticator?.state === "on" && (
          <div className="account-actions">
            <span className="account-words">
              {recoveryCodesLeftWords(authenticator.recoveryCodesLeft)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setOpen("new-recovery-codes")}>
              Make new recovery codes
            </Button>
            <Button variant="danger-ghost" size="sm" onClick={() => setOpen("turn-off")}>
              Turn off
            </Button>
          </div>
        )}
        {settingUp.data && (
          <SetUpAuthenticatorDialog setup={settingUp.data} onClose={() => settingUp.reset()} />
        )}
        {open === "turn-off" && <TurnOffAuthenticatorDialog onClose={() => setOpen(undefined)} />}
        {open === "new-recovery-codes" && (
          <NewRecoveryCodesDialog onClose={() => setOpen(undefined)} />
        )}
      </Card>
    </div>
  );
}

export function recoveryCodesLeftWords(left: number): string {
  if (left === 0) return "No recovery codes left: make new ones.";
  return `${left} recovery ${left === 1 ? "code" : "codes"} left.`;
}
