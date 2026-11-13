import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { createFirstUser, userQueries } from "../../api/users.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useSignedIn } from "./use-signed-in.ts";

/**
 * At first run, while no user exists: the first user's name, email and password, which creates
 * them and signs this browser in. Should someone else create the first user meanwhile, the page
 * reads again and offers signing in.
 */
export function FirstUserForm(): ReactNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();
  const signedIn = useSignedIn();
  const creating = useMutation({
    mutationFn: () => createFirstUser({ name: name.trim(), email: email.trim(), password }),
    onSuccess: signedIn,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: userQueries.signInPage().queryKey });
      }
    },
  });
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
        <RefusalAlert title="The first user can't be created" error={creating.error} />
      )}
      <Input
        label="Name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        autoFocus
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
