import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { SIGN_IN_FAILED_PARAMETER } from "@the-office/contracts";
import { Alert, Button, Card, useAppearance } from "@the-office/ui";
import type { ReactNode } from "react";
import { userQueries } from "../../api/users.ts";
import { OfficeMark } from "../../shell/office-mark.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { FirstUserForm } from "./first-user-form.tsx";
import { SignInWays } from "./sign-in-ways.tsx";
import "./sign-in.css";

/**
 * The sign-in page, outside the shell (spec §2.10): at first run the first user's form, otherwise
 * only the ways to sign in that work at the address the page was opened at, as the service lists
 * them, and why Continue with a provider didn't sign in, when it came back refused.
 */
export function SignInPage(): ReactNode {
  const page = useQuery(userQueries.signInPage());
  const firstRun = page.data?.firstRun === true;
  return (
    <main className="sign-in-page">
      <div className="sign-in-column">
        <OfficeName />
        <h1>{firstRun ? "Create the first user" : "Sign in to The Office"}</h1>
        {firstRun && (
          <p className="sign-in-lead">
            The Office has no users yet. The first one is you; once you are in, you add accounts for
            others.
          </p>
        )}
        {page.error && (
          <RefusalAlert
            title="The sign-in page can't be read"
            error={page.error}
            action={
              <Button variant="secondary" size="sm" onClick={() => void page.refetch()}>
                Try again
              </Button>
            }
          />
        )}
        <ProviderRefusal />
        {page.data && (
          <Card>
            {firstRun ? (
              <FirstUserForm />
            ) : (
              <SignInWays ways={page.data.ways} unavailable={page.data.unavailable} />
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

/** Why the provider's trip back signed nobody in; dismissed by the user. */
function ProviderRefusal(): ReactNode {
  const search = useSearch({ from: "/sign-in" });
  const navigate = useNavigate({ from: "/sign-in" });
  const reason = search[SIGN_IN_FAILED_PARAMETER];
  if (reason === undefined) return null;
  const { [SIGN_IN_FAILED_PARAMETER]: _dismissed, ...rest } = search;
  return (
    <Alert
      tone="danger"
      title="You weren't signed in"
      onClose={() => void navigate({ search: rest, replace: true })}
    >
      {reason}
    </Alert>
  );
}

function OfficeName(): ReactNode {
  const { base } = useAppearance();
  return (
    <div className="sign-in-office">
      <OfficeMark size={28} tone={base} />
      <span>The Office</span>
    </div>
  );
}
