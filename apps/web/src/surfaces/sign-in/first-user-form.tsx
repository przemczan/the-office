import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError, RefusedAs } from "../../api/api-client.ts";
import { createFirstUser, userQueries } from "../../api/users.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * At first run, while no user exists: the setup token printed on the host, then the first user's
 * name, email and password, which creates them and signs this browser in. The token is checked
 * first: a missing, wrong or replaced one is refused (403) with how to print a new one. Should
 * someone else create the first user meanwhile, the page reads again and offers signing in.
 */
export function FirstUserForm(): ReactNode {
  const [setupToken, setSetupToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const creating = useMutation({
    mutationFn: () =>
      createFirstUser({
        setupToken: setupToken.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
      }),
    // The first user sets their own password, so it never asks for one.
    onSuccess: (outcome) => (outcome.outcome === "set-password" ? undefined : signedIn(outcome)),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: userQueries.signInPage().queryKey });
      }
    },
  });
  const tokenRefused = creating.error instanceof RefusedAs && creating.error.status === 403;
  return (
    <form
      className="sign-in-form"
      aria-label="Create the first user"
      onSubmit={(event) => {
        event.preventDefault();
        creating.mutate();
      }}
    >
      {creating.error && (
        <RefusalAlert
          title={tokenRefused ? "The setup token was refused" : "The first user can't be created"}
          error={creating.error}
        />
      )}
      <div className="sign-in-setup-token">
        <Input
          label="Setup token"
          autoComplete="off"
          spellCheck={false}
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
          required
          autoFocus
        />
        <p className="sign-in-hint">
          The Office printed it when it first started. For a new one, run{" "}
          <code>npm run setup-token</code> in The Office&apos;s folder on the computer it runs on.
        </p>
      </div>
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
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <Button type="submit" variant="primary" fullWidth disabled={creating.isPending}>
        Create the first user
      </Button>
    </form>
  );
}
