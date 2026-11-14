import { useMutation } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Button } from "@the-office/ui";
import { continueWith } from "../../api/linked-identities.ts";
import { GoogleMark } from "../../shell/google-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import type { SignInWayView } from "./sign-in-ways.tsx";

/**
 * Continue with Google (spec §2.10): the browser goes to Google, which sends it back to The Office
 * signed in when the Google account is linked to a user, or to this page with why not. Offered
 * only at `localhost` and the public address, since Google refuses an IP address.
 */
export const GoogleWay: SignInWayView<"google"> = () => {
  const returnTo = useSearch({ from: "/sign-in", select: (search) => search.returnTo });
  const starting = useMutation({
    mutationFn: () => continueWith("google", returnTo),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  return (
    <div className="sign-in-form">
      {starting.error && (
        <RefusalAlert title="Continue with Google didn't start" error={starting.error} />
      )}
      <Button
        variant="secondary"
        fullWidth
        iconLeft={<GoogleMark />}
        // Still going once answered, until the browser leaves for Google.
        loading={starting.isPending || starting.isSuccess}
        onClick={() => starting.mutate()}
      >
        Continue with Google
      </Button>
    </div>
  );
};
