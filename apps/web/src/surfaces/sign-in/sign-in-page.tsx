import { useQuery } from "@tanstack/react-query";
import { Button, Card } from "@the-office/ui";
import type { ReactNode } from "react";
import { userQueries } from "../../api/users.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { FirstUserForm } from "./first-user-form.tsx";
import { OfficeName } from "./office-name.tsx";
import { SignInWays } from "./sign-in-ways.tsx";
import "./sign-in.css";

/**
 * The sign-in page, outside the shell (spec §2.10): at first run the first user's form, otherwise
 * only the ways to sign in that work at the address the page was opened at, as the service lists
 * them.
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
        {page.data && (
          <Card>{firstRun ? <FirstUserForm /> : <SignInWays ways={page.data.ways} />}</Card>
        )}
      </div>
    </main>
  );
}
