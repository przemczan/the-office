import { Alert, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useCopyText } from "../../../shell/copy-text.ts";

/**
 * A one-time password as the service answered it, this once: never shown again, so the user copies
 * it and passes it on by hand.
 */
export function OneTimePasswordShown({
  name,
  email,
  oneTimePassword,
}: {
  readonly name: string;
  readonly email: string;
  readonly oneTimePassword: string;
}): ReactNode {
  const copyText = useCopyText();
  return (
    <div className="dialog-stack">
      <p className="dialog-text">
        Pass this one-time password on to {name}. They sign in with {email} and it, then set their
        own password. It works for 7 days.
      </p>
      <div className="one-time-password">
        <code aria-label="One-time password">{oneTimePassword}</code>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Icon name="copy" size={14} />}
          onClick={() => copyText(oneTimePassword)}
        >
          Copy
        </Button>
      </div>
      <Alert tone="warning" title="Shown only once">
        Once this window closes, the one-time password can't be read again. If it gets lost, make a
        new one from the user's row.
      </Alert>
    </div>
  );
}
