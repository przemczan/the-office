# Sign-in pages

Covers: the sign-in page, the first-user form (setup token), the ways to sign in (password, passkey, Continue with GitHub, Google, OpenID Connect provider), ways that don't work at this address, the first-password form, the code page, where sign-in leads.

## Where it is

- Routes: `/sign-in` and `/sign-in/code`; both keep `?returnTo=`.
- They are the only pages shown before signing in, drawn bare: outside the shell, with no rail, top bar, status strip or event stream ([shell.md](shell.md)).
- A 401 on any request, or the event stream's 4401, sends the browser here ([2.10](../2.10-users-and-signing-in.md)).
- `/sign-in?signInFailed=<reason>` is where a provider's trip back lands when it signed nobody in.

## Layout

- One centred column: the Office name (the mark and "The Office"), the heading, a lead line, alerts, and a card holding the form.
- The code page adds a **‹ Back to sign in** link under its card.
- In a test instance of The Office the [Test instance banner](shell.md#test-instance-banner) shows above it.

## Sign-in page

- Heading **Sign in to The Office**; while The Office waits for its first user, **Create the first user** ([First user](#first-user)).
- The page asks the service which ways work at the address it was opened at (`GET /sign-in`) and shows only those, in the service's order, with a rule reading "or" between two ways.
- A failed read shows the alert "The sign-in page can't be read" with **Try again**.
- A provider's refusal shows above the card as the danger alert "You weren't signed in" with the reason; closing it drops `signInFailed` from the address.

## Ways to sign in

### Password

- A form named "Sign in with a password": **Email** and **Password**, the button **Sign in**.
- A refusal shows the service's words as a danger alert. Once wrong tries cost a wait or locked the password it also says when to try again: "Try again in 16 seconds." (counted down each second up to a minute), "Try again at 14:32." beyond; **Sign in** is disabled until then, with the words as its hover.
- A right one-time password (a user another user added) goes on to [Set your password](#set-your-password) in place of this form.

### Passkey

- The button **Sign in with a passkey**; no email is asked, and the browser offers the passkeys it keeps for this address.
- Closing the browser's window is quiet: "No passkey was used. Try again when you're ready."
- Any other refusal shows the service's one answer as a danger alert, titled "The passkey didn't sign you in" when it gives none.
- A browser without passkeys shows "This browser can't sign in with a passkey." in place of the button.

### Continue with GitHub

- The button **Continue with GitHub** (GitHub icon): the browser goes to GitHub, which comes back signed in when its account is linked to a user ([account.md](account.md#linked-identities)).
- It is never worded "Sign in with GitHub": that is The Office's own git identity ([settings.md](settings.md)).
- The button shows loading until the browser leaves. A failure to start shows the alert "Continue with GitHub didn't start".
- GitHub works at every address.

### Continue with Google

- The button **Continue with Google** (Google mark), the same flow through Google; alert "Continue with Google didn't start".
- It is listed only at `localhost` and the public address while a Google OAuth client is saved in Settings › Signing in ([settings.md](settings.md)).
- At an IP address it is shown as unavailable ([Not available here](#not-available-here)).

### Continue with <name>

- The button **Continue with <name>**, "Continue with Zitadel" for an OpenID Connect provider saved with that name; alert "Continue with <name> didn't start".
- It works at every address while the provider is saved in Settings › Signing in.

## Not available here

- Each way that is set up but doesn't work at this address shows as a quiet line below the ways, with a link to where it works:
  - password: "Signing in with a password doesn't work at this address.";
  - passkey: "Passkeys don't work at an IP address." or "Passkeys need The Office's public address: a domain name over HTTPS.";
  - GitHub: "Continue with GitHub doesn't work at this address.";
  - Google: "Continue with Google doesn't work at an IP address." or "Continue with Google works only at localhost or The Office's public address over HTTPS.";
  - OpenID Connect: "Continue with the OpenID Connect provider doesn't work at this address."
- The link reads "Open <host>" and goes to the same page at that address.

## First user

- Shown while no user exists. Lead: "The Office has no users yet. The first one is you; once you are in, you add accounts for others."
- A form named "Create the first user", with:
  - **Setup token** (required, focused); hint "The Office printed it when it first started. For a new one, run `npm run setup-token` in The Office's folder on the computer it runs on.";
  - **Name**, **Email**, **Password** (hint "At least 12 characters.");
  - the button **Create the first user**.
- It creates the user and signs this browser in.
- A refused setup token (403) shows "The setup token was refused"; any other refusal "The first user can't be created", with the service's reasons.
- If someone else created the first user meanwhile (409), the page reads again and offers signing in.
- The browser checks the required fields and the email's form before the service's reasons show.

## Set your password

- Shown in place of the password form after a right one-time password; a form named "Set your password".
- Lead: "This is your first sign-in as <email>. Choose your own password; the one-time password stops working once it is set."
- **New password** (hint "At least 12 characters.") and **Repeat the new password**; the two are compared as typed, and a difference shows "The two passwords differ." and disables the button.
- The button **Set the password and sign in**; it sends the new password with the one-time password again, which only this form's memory holds.
- **Back to signing in** forgets the one-time password and returns to the password form.
- A refusal shows the service's words, or "The password can't be set".

## Code page

- Heading **Authenticator code**; lead "Your authenticator is on: open its app and type the code it shows for The Office."
- Reached after a password, Continue with GitHub or Continue with Google when the user's authenticator is on.
- A form named "Sign in with the authenticator code": **Authenticator code** (hint "The 6 digits your authenticator app shows for The Office."; 6 digits, numeric keypad, one-time-code autofill) and the link "Use a recovery code", which swaps it for **Recovery code** (hint "One of the codes you saved when you set up the authenticator, such as 7KQ2M-XC9RT.") and "Use the authenticator code".
- The button **Sign in**.
- A refusal shows the service's words and, once wrong tries cost a wait, when to try again as on the password form; **Sign in** waits until then.
- **‹ Back to sign in** returns to `/sign-in`, keeping `returnTo`.
- Once the pending sign-in has ended, the service answers 401 and the browser goes back to `/sign-in` with the code page's own `returnTo`.

## Where signing in leads

- Signed in: every cached query is cleared (it may be another user's), the account is read and its appearance shown so the first paint is the user's own, then the address is replaced with `?returnTo=` (a path of this app only), else home ([now.md](now.md)).
- Authenticator code needed: the code page.
- The `returnTo` is a query parameter of that name; the page never knows it is signed in until a request answers (the cookie is `HttpOnly`).

## States

- Loading: the card isn't shown until the page's read answers.
- Error: "The sign-in page can't be read" with **Try again**.
- Pending: a way's button shows loading; the password and code **Sign in** buttons are disabled while sending.
- Narrow window: one column, as at any width.

## Domain facts

- [Users and signing in](../2.10-users-and-signing-in.md).
- [Permissions and safety](../6-permissions-and-safety.md).
