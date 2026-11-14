import { useMutation } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Button, Icon } from "@the-office/ui";
import { continueWith } from "../../api/linked-identities.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import type { SignInWayView } from "./sign-in-ways.tsx";

/**
 * Continue with GitHub (spec §2.10): the browser goes to GitHub, which sends it back to The Office
 * signed in when the GitHub account is linked to a user, or to this page with why not. Never "Sign
 * in with GitHub", which is The Office's own git identity.
 */
export const GitHubWay: SignInWayView<"github"> = () => {
  const returnTo = useSearch({ from: "/sign-in", select: (search) => search.returnTo });
  const starting = useMutation({
    mutationFn: () => continueWith("github", returnTo),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  return (
    <div className="sign-in-form">
      {starting.error && (
        <RefusalAlert title="Continue with GitHub didn't start" error={starting.error} />
      )}
      <Button
        variant="secondary"
        fullWidth
        iconLeft={<Icon name="github" size={14} />}
        // Still going once answered, until the browser leaves for GitHub.
        loading={starting.isPending || starting.isSuccess}
        onClick={() => starting.mutate()}
      >
        Continue with GitHub
      </Button>
    </div>
  );
};
