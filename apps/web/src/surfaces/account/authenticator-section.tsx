import { useMutation } from "@tanstack/react-query";
import type { AuthenticatorState } from "@the-office/contracts";
import { Alert, Badge, Button, Card, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { setUpAuthenticator } from "../../api/users.ts";
import {
  NewRecoveryCodesDialog,
  SetUpAuthenticatorDialog,
  TurnOffAuthenticatorDialog,
} from "./authenticator-dialogs.tsx";

type OpenDialog = "turn-off" | "new-recovery-codes" | undefined;

/**
 * The user's authenticator (spec §2.10): off, with Set up; or on, with how many recovery codes are
 * left, New recovery codes and Turn off, each asking for a code.
 */
export function AuthenticatorSection({
  authenticator,
}: {
  readonly authenticator: AuthenticatorState | undefined;
}): ReactNode {
  const [open, setOpen] = useState<OpenDialog>();
  const settingUp = useMutation({ mutationFn: setUpAuthenticator });
  return (
    <Card
      title={
        <span className="account-block-title">
          <Icon name="smartphone" size={15} strokeWidth={1.6} />
          Authenticator
          {authenticator?.state === "on" && (
            <Badge tone="success" size="sm">
              On
            </Badge>
          )}
        </span>
      }
      subtitle="After your password, Continue with GitHub or Continue with Google, The Office asks for a code from an app on your phone. A passkey needs none."
    >
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
  );
}

export function recoveryCodesLeftWords(left: number): string {
  if (left === 0) return "No recovery codes left: make new ones.";
  return `${left} recovery ${left === 1 ? "code" : "codes"} left.`;
}
