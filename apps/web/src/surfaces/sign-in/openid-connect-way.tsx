import { useMutation } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Button } from "@the-office/ui";
import { continueWith } from "../../api/linked-identities.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import type { SignInWayView } from "./sign-in-ways.tsx";

/**
 * Continue with the OpenID Connect provider (spec §2.10), shown under the name it was set up with:
 * the browser goes to the provider, which sends it back signed in when its account is linked to a
 * user. Works at every address.
 */
export const OpenIdConnectWay: SignInWayView<"openid-connect"> = ({ way }) => {
  const returnTo = useSearch({ from: "/sign-in", select: (search) => search.returnTo });
  const starting = useMutation({
    mutationFn: () => continueWith("openid-connect", returnTo),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  });
  return (
    <div className="sign-in-form">
      {starting.error && (
        <RefusalAlert title={`Continue with ${way.name} didn't start`} error={starting.error} />
      )}
      <Button
        variant="secondary"
        fullWidth
        // Still going once answered, until the browser leaves for the provider.
        loading={starting.isPending || starting.isSuccess}
        onClick={() => starting.mutate()}
      >
        Continue with {way.name}
      </Button>
    </div>
  );
};
