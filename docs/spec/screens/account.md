# Account page

Covers: the Account page and its sections (Profile and Password, Authenticator and recovery codes, Appearance, Notifications, Passkeys, Linked identities, Signed-in devices).

## Where it is

- Route: `/account`, which opens Profile; opened from the top bar's user menu ([shell.md](shell.md)).
- Sections: `/account/profile`, `/account/authenticator`, `/account/appearance`, `/account/notifications`, `/account/passkeys`, `/account/linked-identities`, `/account/signed-in-devices`.
- The page title is "Account"; its crumb is the open section's name.

## Layout

- A section menu (label "Account"), then the open section's cards.
- Menu items, in order, with their icons: **Profile**, **Authenticator**, **Appearance**, **Notifications**, **Passkeys**, **Linked identities**, **Signed-in devices**.

## Profile

### Profile card

- Title "Profile". A form named "Profile": **Name** and **Email** (hint "You sign in with it."), both required.
- **Save** and **Discard** are disabled, with the hover "Nothing changed yet.", until a field differs; **Discard** puts the saved values back.
- Done: toast "Your profile was saved."; a refusal shows "The profile can't be saved". A failed read shows "The account can't be read".

### Password card

- Title "Password", subtitle "Changing it signs you out on every other device; this one stays signed in."
- A form named "Change password": **Current password**, **New password** (hint "At least 12 characters."), **Repeat the new password**.
- **Change password** is disabled with "Fill in all three." until all are filled and with "The two new passwords differ." (also on the field) while the two differ.
- Done: toast "Your password was changed. Your other devices are signed out."; the fields clear and the signed-in devices are read again. A refusal shows "The password can't be changed".
- A wrong current password is answered "The current password is wrong." and counts toward the same slow-down and lockout as signing in.

## Authenticator

- Card "Authenticator" with an **On** badge (success) while it is on; subtitle "After your password, Continue with GitHub or Continue with Google, The Office asks for a code from an app on your phone. A passkey needs none."
- Off: "Off: your password alone signs you in." and **Set up the authenticator**; a refusal shows "The authenticator can't be set up".
- On: the recovery codes left ("No recovery codes left: make new ones.", "1 recovery code left.", "<n> recovery codes left."), **Make new recovery codes** and **Turn off** (danger ghost).

### Set up the authenticator window

- Title "Set up the authenticator"; medium.
- Text: "Scan the QR code with an authenticator app on your phone, such as 1Password, Google Authenticator or Microsoft Authenticator, then type the code it shows."
- The QR code (alt "The QR code for your authenticator app", 180 by 180), drawn in the browser from the key's `otpauth://` address so it reaches no other site, dark on light in every palette.
- "Can't scan it? Type this key into the app:" with the key in groups of 4.
- The code field (**Authenticator code**, no recovery-code switch) and the refusal with its wait, as on the code page ([sign-in.md](sign-in.md#code-page)).
- Button **Turn on the authenticator**.
- Once on, the window becomes "Save your recovery codes", showing the recovery codes this once ([Recovery codes](#recovery-codes)).

### Turn off the authenticator window

- Title "Turn off the authenticator"; small.
- Text: "Signing in then asks for no code, and your recovery codes stop working."
- The code field (an authenticator code or a recovery code) and the refusal with its wait.
- Button **Turn off** (danger), waiting until the wait ends.

### Make new recovery codes window

- Title "Make new recovery codes"; text "New recovery codes replace all your old ones, used or not, which then stop working."
- The code field (authenticator code only) and the refusal with its wait.
- Button **Make new recovery codes**.
- Once made, the window becomes "Save your new recovery codes" ([Recovery codes](#recovery-codes)).

### Recovery codes

- Text: "Save these recovery codes somewhere safe, such as a password manager. Each signs you in once in place of an authenticator code, if you lose your phone. They show only now."
- The codes as a numbered list named "Recovery codes".
- **Copy the codes** (toast "Recovery codes copied."; "The recovery codes couldn't be copied. Select them and copy them instead.") and **Download the codes** (a text file `the-office-recovery-codes.txt` made in the browser).
- Closing the window needs no confirmation, and the secret and codes are gone with it; nothing caches them.

## Appearance

- Card **Palette**: a choice per palette, each with a preview of it and its name, then **Follow the system**; the chosen one is pressed. Note: "A palette changes colours only, never the layout. It is yours: it follows you to every browser you sign in on."
- Card **Density**: a choice per density, each previewed. Note: "A density changes spacing and sizes only, never the colours. It is yours: it follows you to every browser you sign in on."
- A choice applies at once and is saved to the account.

## Notifications

- Every card here is yours: it decides only what reaches you, on every browser you sign in on ([2.7](../2.7-notifications.md#each-users-own-settings)).
- **What goes where** card: "A row inherits from its group until you set it. Splitting a kind later keeps every setting. The Project filter never silences anything." A grid of the kinds tree by the channels **In-app**, **Desktop** and **Phone** (each column with a note); a click sets a cell on its row, an unset cell is inherited from its group, and a group's reset button ("Inherit everything from <group> again") gives its kinds back.
- **At the desk** card: "Hold phone pushes while you are at the desk: The Office focused or used in the last N minutes" and "Send anything still unhandled to your phone N minutes after you leave"; note "Desktop notifications show only when the tab isn't focused; otherwise a toast does."
- **Quiet hours and batching** card: **Quiet hours** (a checkbox with "from" and "to" times; "Nothing is pushed to you inside the window except "the service or an Agent engine down"; one summary comes when it ends."; "Off until you set them."), "Collapse Outcomes that land within N minutes into one", and "Needs you is pushed once per item and never batched. There are no repeat reminders."
- Each change is sent at once; a refusal shows as "The change can't be saved".
- `/settings/notifications` goes here ([settings.md](settings.md#where-it-is)).

## Passkeys

- Card "Passkeys" with the count; subtitle "A passkey signs you in alone, with no password or code. Each works only at the address it was added at."
- **Add a passkey** (plus icon, primary) in the card's head, shown where adding works; disabled with "This browser can't make passkeys." in a browser without them.
- Where adding doesn't work at this address, an info alert says why ("Passkeys don't work at an IP address." or "Passkeys need The Office's public address: a domain name over HTTPS.") with "Open <host> to add one", or "Open The Office at localhost or at its public address to add one.", in place of the button.
- A failed read shows "The passkeys can't be read".
- Table columns: **Passkey** (name, and under it where it works), **Added**, **Last used** ("Never" until used), and the actions **Rename** and **Remove** (labels "Rename <name>", "Remove <name>").
- Where it works: "Works at <host>", "Use it at <host>" (a link to that address's page), or for an address no longer The Office's, with the warning badge **Old address**, "Added at <host>, no longer The Office's address: it can't sign in." (it can only be removed).
- Empty: "No passkeys yet."

### Add a passkey window

- First step, title "Add a passkey": "A passkey signs you in alone, so The Office asks for your current password first." with **Current password** and **Continue** (disabled with "Give your current password." until typed). A refusal shows "The passkey can't be added".
- Second step, title "Name the passkey": "A name tells your passkeys apart, such as the device or password manager that keeps it. Your browser then asks you to make it." with **Name** (at most the passkey name length) and **Add the passkey** (disabled with "Give the passkey a name.").
- Closing the browser's own window is quiet: "No passkey was made. Add the passkey to try again."
- Done: toast "The passkey <name> was added."
- A passkey's options are tied to the device that asked and live 5 minutes.

### Rename window

- Title "Rename <name>"; **Name**, **Save** (disabled with "Give the passkey a name."); refusal "The passkey can't be renamed".

### Remove window

- Title "Remove <name>?"; text "It no longer signs you in. Your device or password manager may still list it; remove it there too."
- Button **Remove the passkey** (danger); refusal "The passkey can't be removed"; toast "The passkey <name> was removed."

## Linked identities

- Card "Linked identities"; subtitle "Continue with GitHub, Google or your OpenID Connect provider on the sign-in page signs you in with the account linked here, never by your email."
- One row per provider (GitHub, Google, the OpenID Connect provider by its saved name) with its icon.
- Linked: a success badge with the linked login (Google shows the linked email), "Linked <moment> · last signed in <moment>" or "· never signed in with", and **Unlink** (label "Unlink <name>").
- Not linked: "Not linked." and **Link** (label "Link <name>"), which goes to the provider's authorize page and comes back here; it shows loading until the browser leaves. A refusal shows "Linking can't start".
- Link is disabled, with the reason as its hover and on the row, while:
  - GitHub isn't set up: "Register the GitHub App in Settings › Office identity first.";
  - Google isn't set up: "Save a Google OAuth client in Settings › Signing in first.";
  - the OpenID Connect provider isn't set up: "Save an OpenID Connect provider in Settings › Signing in first.";
  - it doesn't work at this address: "Linking GitHub doesn't work at this address.", for Google its address words followed by "Open The Office at <host> to link it." (or "localhost or its public address"), "Linking doesn't work at this address." for OpenID Connect.
- A failed link comes back with `?linkFailed=<reason>` and shows the danger alert "The identity wasn't linked", closable.
- A failed read shows "The linked identities can't be read".

### Unlink window

- Title "Unlink <name>?"; text "Continue with <name> no longer signs you in as <login>. You can link it again from here."
- Button **Unlink the account** (danger); refusal "<name> can't be unlinked"; toast "Your <name> account was unlinked."

## Signed-in devices

- Card "Signed-in devices" with the count; subtitle "Each browser you signed in from, the most recently used first. Sign out one you no longer use or don't know."
- Columns: **Device** (the browser in words from its user agent, "Chrome on Linux", "A browser on <system>" or "A browser" when unknown; the badge **This device** on this one), **Address** (Localhost, Loopback IP, Local network, Public address), **Signed in**, **Last used**, and **Sign out**.
- **Sign out** has the label "Sign out this device" on this one, otherwise "Sign out <browser>, last used <moment>".
- Another device's sign-out reads the list again; this device's lands on the sign-in page ([sign-in.md](sign-in.md)).
- The other device's next request answers 401 and its event stream closes with 4401; nothing here waits for that.
- A failed read shows "The signed-in devices can't be read".
- Empty: "No signed-in devices."
- A signed-in device is never called a session.

## States

- Loading: the tables show their loading state; the Profile form shows once the account is read.
- Error: each section's own alert, as named above.
- Narrow window: the devices table stacks under 640px; the section menu follows the shell's section layout ([shell.md](shell.md)).

## Domain facts

- [Users and signing in](../2.10-users-and-signing-in.md).
- [Notifications](../2.7-notifications.md).
- [Permissions and safety](../6-permissions-and-safety.md).
