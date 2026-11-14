import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account } from "@the-office/contracts";
import { Button, Card, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ACCOUNT, changePassword, changeProfile, userQueries } from "../../api/users.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { AccountCardTitle } from "./account-card-title.tsx";

/** Account › Profile (spec §2.10): the user's name and email, and Change password. */
export function ProfileSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Profile" });
  const account = useQuery(userQueries.account());
  return (
    <div className="account-cards">
      <Card title={<AccountCardTitle icon="user-round">Profile</AccountCardTitle>}>
        {account.error && <RefusalAlert title="The account can't be read" error={account.error} />}
        {account.data && <ProfileForm key={account.data.id} account={account.data} />}
      </Card>
      <Card
        title={<AccountCardTitle icon="key-round">Password</AccountCardTitle>}
        subtitle="Changing it signs you out on every other device; this one stays signed in."
      >
        <PasswordForm />
      </Card>
    </div>
  );
}

function ProfileForm({ account }: { readonly account: Account }): ReactNode {
  const [name, setName] = useState(account.name);
  const [email, setEmail] = useState(account.email);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: () => changeProfile({ name: name.trim(), email: email.trim() }),
    onSuccess: (saved) => {
      queryClient.setQueryData(ACCOUNT, saved);
      showToast("Your profile was saved.");
    },
  });
  const changed = name.trim() !== account.name || email.trim() !== account.email;
  return (
    <form
      className="account-form"
      aria-label="Profile"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) saving.mutate();
      }}
    >
      {saving.error && <RefusalAlert title="The profile can't be saved" error={saving.error} />}
      <Input
        label="Name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <Input
        label="Email"
        type="email"
        autoComplete="username"
        hint="You sign in with it."
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <div className="account-form-actions">
        <Button
          type="submit"
          variant="primary"
          loading={saving.isPending}
          disabled={!changed}
          title={changed ? undefined : "Nothing changed yet."}
        >
          Save
        </Button>
        <Button
          variant="secondary"
          disabled={!changed}
          title={changed ? undefined : "Nothing changed yet."}
          onClick={() => {
            setName(account.name);
            setEmail(account.email);
            saving.reset();
          }}
        >
          Discard
        </Button>
      </div>
    </form>
  );
}

function PasswordForm(): ReactNode {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const showToast = useToast();
  const queryClient = useQueryClient();
  const changing = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setRepeated("");
      await queryClient.invalidateQueries(userQueries.signedInDevices());
      showToast("Your password was changed. Your other devices are signed out.");
    },
  });
  const mismatch = repeated !== "" && repeated !== newPassword;
  const missing = currentPassword === "" || newPassword === "" || repeated === "";
  const why = mismatch
    ? "The two new passwords differ."
    : missing
      ? "Fill in all three."
      : undefined;
  return (
    <form
      className="account-form"
      aria-label="Change password"
      onSubmit={(event) => {
        event.preventDefault();
        if (why === undefined) changing.mutate();
      }}
    >
      {changing.error && (
        <RefusalAlert title="The password can't be changed" error={changing.error} />
      )}
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        required
      />
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        required
      />
      <Input
        label="Repeat the new password"
        type="password"
        autoComplete="new-password"
        value={repeated}
        onChange={(event) => setRepeated(event.target.value)}
        error={mismatch ? "The two new passwords differ." : undefined}
        required
      />
      <div className="account-form-actions">
        <Button
          type="submit"
          variant="primary"
          loading={changing.isPending}
          disabled={why !== undefined}
          title={why}
        >
          Change password
        </Button>
      </div>
    </form>
  );
}
