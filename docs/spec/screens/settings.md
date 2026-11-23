# Settings

Covers: the Settings page and its sections (Pipelines list, Stage templates and their linked Stages, Duties, Skills, MCP servers, Engines, Users, Signing in, Office identity, Office limits, Office instructions, Prompt templates, Telemetry, Updates), First-run setup.

## Where it is

- Routes: `/settings/<section>`; `/settings` opens Pipelines. `/settings/appearance` goes to `/account/appearance`, and for one release `/settings/notifications` goes to `/account/notifications` ([account.md](account.md#notifications)): notification settings are each user's own.
- Open it from the Settings item in the rail ([shell.md](shell.md)).
- The page title is "Settings"; its crumb is the open section's name.
- The Project filter in the top bar doesn't narrow Settings: it holds Office-wide settings.

## Layout

- A left-hand menu named "Settings" beside the open section.
- Menu items, in order, each with an icon: **Pipelines**, **Duties**, **Skills**, **MCP servers**, **Engines**, **Users**, **Signing in**, **Office identity**, **Office limits**, **Office instructions**, **Prompt templates**, **Telemetry**, **Updates**.
- Each section is a page of its own at its route: `/settings/pipelines`, `/settings/duties`, `/settings/skills`, `/settings/mcp-servers`, `/settings/engines`, `/settings/users`, `/settings/signing-in`, `/settings/office-identity`, `/settings/office-limits`, `/settings/office-instructions`, `/settings/prompt-templates`, `/settings/telemetry`, `/settings/updates`.
- Most sections are cards. A card with a draft has **Save** and **Discard** (disabled while nothing changed; titles "No changes to save", "No changes to discard"); a refusal shows as an alert under the card with the service's reasons.
- A section that can't read its data shows a problem alert named "The <thing> can't be read".

## Pipelines

- Route: `/settings/pipelines` (the first section), `/settings/pipelines/<pipelineId>`, `/settings/pipelines/stage-templates`, `/settings/pipelines/stage-templates/$stageTemplateId`; `?proposal=<id>` names an open Proposal of that Pipeline's routes.
- Two tabs, each with its count: **Pipelines** and **Stage templates**, each a list beside its open item. A Stage template's address opens its tab; `/settings/pipelines/stage-templates` opens the first template.
- Pipelines tab: a list named "Office-wide Pipelines" beside the open item. Each row links to its Pipeline; its second line is its Stages line.
- The list's head has **New Pipeline**; its foot has **Duplicate** (for the open Pipeline; a refusal shows as "The Pipeline wasn't duplicated"). Empty: "No Pipeline yet. Make one from scratch with New Pipeline."
- The open Pipeline: its head with the badge **Office-wide**, its name, description and Stages in the shared Stage editor ([pipeline-flow-editor.md](pipeline-flow-editor.md) holds the flow editor), **Save**, **Discard** and **Remove** (with the service's reasons).
- Saving it never changes a Project Pipeline, even one copied from it ([2.3.5](../2.3.5-library.md#library)).
- A problem of the check holds Save; a flag (a Role nobody fills) doesn't. A row's "Needs fixing" mark comes from one check of the whole library (`GET /api/pipelines/library/needs-fixing`), never one check per row.
- A change the user makes (Save, Duplicate, Remove) waits only for the list to read again before the address follows; the checks read again after it, on the change's event.
- With `?proposal=<id>` and "Show it on the flow" on a Proposal's card, the Proposal shows read-only on the flow under the banner in place of the form.
- **Stage templates** tab: a list "Stage templates" with **New template** (a menu of the Stage kinds: **Agent Stage**, **Script Stage**, **Gate**, **Publish Stage**). Each row links to its template with its kind's icon, who works it or its command, and a warning mark from its own check. Empty: "No Stage template yet. Make one with New template, or use Save as template on a Stage in a Pipeline."
- An open template shows in the detail column: its one Stage in the Stage form (no Routes out; its Project command picked from every Project's keys), **Ask Devops** in its head with a draft naming the template, **Save**, **Discard** and **Remove**.
- Under the form, a **Linked Stages · N** card: a row per linked Stage with its Pipeline (office-wide, or "<Project>'s"), the Stage's name and "Same as the template" or "Differs in <fields>", each linking to the Stage in its Pipeline's editor. Empty: "No Stage is linked to it."
- Only Pipelines' Stages are linked; a Task's own Stages are copies and never listed ([2.3.1](../2.3.1-stages.md#a-stage-linked-to-its-stage-template)).
- **Save** of an edit, while it has linked Stages, opens the dialog "Apply the edit to linked Stages":
  - "This edit changes <fields>.";
  - a table: a checkbox, **Pipeline** (office-wide or "<Project>'s"), **Stage**, **How it differs** ("Same as the template" or "Differs in <fields>"), and "Its own <field> is replaced" where the Stage differs in a field the edit changes;
  - the Stages that don't differ in the fields the edit changes are ticked to begin with;
  - buttons **Save and apply to N Stages**, **Save the template only**, **Cancel**.
- Its result: the toast "<template> saved and applied to N Stages."; a Pipeline that refused the edit is named with why in an alert, the others applied ([2.3.5](../2.3.5-library.md#editing-a-template-with-linked-stages)).
- With no linked Stage, Save saves the template at once.
- **Remove** confirms, saying its N linked Stages keep their fields and are unlinked; it is never refused.
- Ask Devops' Proposal of the template's Stage, applied, opens the same dialog to choose the linked Stages that get it.
- Under 1224px, the list or the open item shows, with "‹ All Pipelines" or "‹ All Stage templates" to go back.
- Facts: [2.3](../2.3-pipelines.md), [2.3.5](../2.3.5-library.md).

## Duties

- Card "Duties" with the text "Each duty is done by the person holding it. Duties follow the Role, so renaming a Role changes nothing; letting someone go leaves their duties to what happens while nobody holds them. A change reaches only what starts after it."
- A row per duty: its label in bold, its description, and a select named by the label with **Nobody** and each hired Role's person ("Ada · Developer"; the Caretaker and anyone let go aren't offered).
- A pick saves at once; the toast is "<duty>: <name> holds it now." or "<duty>: nobody holds it now."; there is no Save.
- Notes under a row: the fallback while nobody holds it ("The Caretaker is the one to talk to.", "You do it yourself.", "Pipelines whose Stages name it are flagged, and Start is refused."), a holder let go named ("<name> held it and was let go; it goes back to them if they are hired back."), and a holder whose Consultant is off ("<name>'s Consultant is off, so they are passed over and you are asked.").
- A refusal shows under its row as "<duty> wasn't changed".
- The duties: **Default person to talk to**, **Shapes Initiatives**, **Plans**, **Implements**, **Reviews**, **Asked first when a Stage runs out of tries**, **Onboards and repairs Projects**, **Default Consultant for MCP tool hard switches**.
- Facts: [2.2](../2.2-people.md#duties-on-screen).

## Skills

- Card "Skills" (the library) with the button **Add a skill** in its head; a table with columns **Skill**, **Source** (with an installed skill's pinned version), **Who has it**, **Uses** (the skill's uses in the last 7 days; the tooltip and accessible name read the number in full), **State** (a badge), and actions.
- An update found at an installed skill's Source shows as "→ version" on its row and in the banner; **Review the update** asks Devops for the update Proposal, or shows their open one with its notes and diff, to apply.
- **Add a skill** opens a window: **Install from a source** (asks Devops in their chat with the source drafted, or says installing needs someone with the Devops Role), **Upload** and **Write**.
- Row actions open windows: Review (a skill waiting for review), Edit, Upload a version, Who has it, Update.
- Empty: "The library is empty. Add a skill: install it from a source, upload it or write it here." A failed read shows "The library can't be read".
- Facts: [2.6](../2.6-skills.md), [5.6](../5.6-skills-per-session.md).

## MCP servers

- Card "MCP servers" (the library) with **Add an MCP server**; a table: **MCP server**, how it runs, **Server values** (and which required ones aren't set Office-wide), **Who has it**, **State** (**On** or **Off**), actions.
- **Add an MCP server**: the form, or pasting a JSON config, which is read into the form to check before adding (nothing kept until then).
- **Edit**: saving turns a server off when what runs changed, and opens its review.
- **Review**: a test connection showing how it runs, its values and the tools it lists (names too long are flagged), or why it couldn't connect; **Turn it on** (against the reviewed state), **Turn it off** and **Remove**.
- A secret's Office-wide value is never sent back: its field is empty and keeps the saved value unless the user types a new one or removes it.
- Empty: "The library is empty. Add an MCP server by the form or by pasting its JSON config." A failed read shows "The library can't be read".
- Facts: [2.2](../2.2-people.md), [6](../6-permissions-and-safety.md).

## Engines

- Route: `/settings/engines`. Everything is edited as one draft with **Save** and **Discard**, sent whole; a refusal shows "The engines weren't saved" with every reason. Toast: "Engines saved. Sessions started from now on use them."
- **Defaults** card: **Office default**, two selects side by side, **Engine type** (the types with a saved engine still listed, in the list's order of types, the picked type's icon beside it) and **Account** (that type's saved engines only, the first in the list's order picked when the type changes), with the hint under both "Where every session runs unless a Project, an Initiative or a Task sets another. How each person works there comes from their Role card." While no engine is saved: "No engine is listed, so no session starts. The first engine saved becomes the Office default."; and the **Search endpoint** (**Base URL**, hint "SearXNG, with json among its search formats. WebSearch on the OpenAI-compatible API goes through it, and is refused while none is set.").
- **Stand-in Engines** card: the Office-wide ordered list by engine name, each row with the engine type's icon, **Move up**, **Move down** and **Remove**; **Add a stand-in** over the saved engines not listed, of every type; the note "On another engine type, a Thread or a new session starts fresh with each person's model and effort for it; a running Stage waits for the reset instead. A Project can use a list of its own."; the field "Ask before switching a Stage whose context is over" (tokens; hint "Above this size a switch of a running Stage waits for your answer; 0 always asks."). Empty: "No Stand-in Engine yet, so work waits for its own engine's usage window to free up."
- The list of engines (a `PickList`) beside the selected one, grouped by engine type under a small heading per type: Claude Code engines first, then Codex, then Copilot CLI, then Gemini CLI, then API endpoints. Each row: the type's icon, the name, a line ("Signed in" or "Signed out" · the default model · "effort <effort>", the effort left out while Not set; an API endpoint's number of models), the Office default marked, and a warning mark for a price that holds Save or an endpoint without a model.
- **Add an engine** in the list's head: a menu with one entry per engine type. Empty: "No engine is listed, so no session starts. Add one with "Add an engine"."
- The detail: the engine's name with **Remove** and tabs. **Settings**: a Claude Code engine's name, **Default model**, **Default effort** and the -p fallback switch; a Codex engine's name, default model and default effort; an API endpoint's name, base URL, key and default model; a Copilot CLI engine's name and default model (Auto); a Gemini CLI engine's name and default model (Auto, Pro, Flash or Flash-Lite). Only Claude Code and Codex engines show a Default effort, as only their types take efforts ([5.4.5](../5.4.5-engines-and-cascade.md#models-and-efforts-of-an-engine-type)). **Default effort** offers "Not set" and the type's efforts in its order; its hint is "How hard the model thinks for anyone who leaves their effort to the engine.", followed by "Left to <type>." while Not set. The key never comes back; it is kept unless the user types one or chooses "Remove the key".
- **Account** (once saved): Claude Code: the line (email and plan, "A pasted token signs it in", "An API key signs it in" or "Signed out"), **Sign in** (a link to the sign-in page and a Code box with **Finish**), **Paste a token instead** (**Save the token**), **Use an API key** (**Save the API key**), **Sign out**. Codex: **Sign in with ChatGPT** (shows the device page and its one-time code), **Use an API key instead** (**Save the key**), **Sign out**. Copilot CLI: **Sign in** (GitHub's device page and one-time code), **Paste a token instead** (a fine-grained personal access token), **Sign out**. Gemini CLI: the line ("A Gemini API key signs it in" or "Signed out"), **Use an API key** (**Save the key**; **Use another API key** once one is set), **Sign out**; no Sign in. What is typed there stays out of the draft.
- **Models and prices**: four prices per model (all four or none); Claude models' and Codex models' prices are shared by every engine of that type and say so; a Copilot CLI engine's, a Gemini CLI engine's and an API endpoint's are its own. An API endpoint's models have a context window and a **Sees images** checkbox each, **Add a model** and **Remove**.
- A saved engine's **Remove** opens a window: the replacement among the other engines (one of the same type suggested, else the Office default), what moves (the Office default, each Project default and Stand-in Engine list, from to; each Task and Initiative whose engine override names it, by name, a Done or Dropped one with its state; a note when the replacement is of another type, or when people's settings for the type go unused as its last engine leaves), problems holding Remove or the warning that the only engine moves everything to none; it saves at once and discards unsaved changes. Toast: "Engine removed. What named it moved to the replacement." An unsaved engine leaves the draft by its Remove.
- While a price on a tab out of sight holds Save, the Save bar names its engine with **Show it**.
- Facts: [5.4](../5.4-the-engine.md), [5.4.1](../5.4.1-engine-kinds.md), [5.4.5](../5.4.5-engines-and-cascade.md), [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).

## Users

- Card "Users": "Everyone who signs in to The Office. Each has their own account; everything else is shared." A table of the users; your own row is marked "You" and its **Remove** is off ("You can't remove yourself.").
- A user who hasn't set their own password is marked "Waiting for first sign-in", or "One-time password expired" past its 7 days.
- **Add a user** (name and email; "Give a name and an email.") opens a window; the answer shows in the same window titled "<name> was added" with the one-time password (**Copy**, alert "Shown only once": it can't be read again). A refusal shows "The user can't be added".
- **New one-time password** on a waiting user's row confirms ("Make a new one-time password for <name>?"; the old one stops working), then shows the new one the same way. A refusal: "The one-time password can't be made".
- **Remove** confirms "Remove <name>?" (it signs out all their devices and their name stays on what they did; "Their email can be given to a new user afterwards."). A refusal: "<name> can't be removed".
- Facts: [2.10](../2.10-users-and-signing-in.md).

## Signing in

- Two cards for the sign-in providers a user can link from Account › Linked identities ([account.md](account.md)).
- **Google**: "Continue with Google signs users in through a Google OAuth client you register, one for every user." Fields **Client ID** and **Client secret** (write-only; "Saved" placeholder once set; an empty secret on Save keeps it), **Save**, **Remove** (confirms "Remove the Google OAuth client?": linked Google accounts stay linked). Toast: "The Google OAuth client was saved: Continue with Google is offered at localhost and the public address." Unset: "Not set up: Continue with Google isn't offered."
- Under it **Redirect URIs** (localhost's, none when the page is open at an IP address, and the public address's; each with **Copy**) and "Setting up the client in Google Cloud Console": the steps to create the client, add each URI under Authorized redirect URIs, copy the ID and secret here, and on the OAuth consent screen choose External with the scopes openid and email.
- **OpenID Connect**: "Continue with your own identity provider (Zitadel, Authentik, Keycloak and others) signs users in through an OpenID Connect client you register there, one for every user." Fields **Name** (shown on the sign-in page as Continue with this name), **Issuer URL** (its discovery document is read as it saves), **Client ID**, **Client secret** (kept as Google's is); **Save**, **Remove** (confirms; linked identities stay linked).
- Saving at another issuer shows the warning "A different issuer unlinks every linked identity". The service's refusals (unreachable, not a discovery document, another issuer) show as written.
- Its **Redirect URIs** (this address's and the public address's, each with **Copy**) come with the note that Zitadel needs the secret's authentication method Basic and Development mode for plain-HTTP URIs.
- Facts: [2.10](../2.10-users-and-signing-in.md).

## Office identity

- Intro: every git command The Office runs uses only these, never your own credentials: Sign in with GitHub for GitHub over https, the Office ssh key for ssh remotes on any host.
- **Sign in with GitHub** card: **Register the GitHub App** (fetches the manifest form and has the browser post it to GitHub, which comes back to `/settings/office-identity`); signed out with the reason The Office gave and **Sign in** (to GitHub's authorize page); signed in as the login with **Sign out**.
- While the App lacks a permission The Office needs, a prompt lists each missing one, with links to add them to the App and to accept them per installation, and **Check again**. The App's install page is a link.
- Once the App is registered, **Continue with GitHub's setup**: the callback URLs to add to the App on GitHub (this address's and the public address's, each with **Copy**; at most 10), a note that a private App must be made public for others, and the warning not to revoke the App's authorization from the git identity's account.
- A registration or sign-in failure shows in the address until dismissed.
- **Office ssh key** card: the public half, masked until **Show**, **Copy the public key** (the whole key either way) and **Regenerate…** (a window enabled once its consequences are acknowledged; toast "The Office ssh key is new. Add its public half to each host The Office reaches over ssh.").
- **Unconfirmed hosts**: each scanned for its keys with **Confirm fingerprint** ("No Unconfirmed host." when none; "Nothing answered on its ssh port, so it shows no key."; toast "<host> is trusted now.").
- **Trusted hosts**: each with its fingerprints; GitHub's marked **From GitHub** ("No Trusted host yet.").
- Facts: [5.5](../5.5-git-and-isolation.md), [5.1](../5.1-shape.md#defaults).

## Office limits

- **Desks** card: **Running Tasks at once across The Office** (a stepper from 1; "Talking is never limited: chats, consultations and Decisions don't take a desk."). Saves at once.
- **Usage** card: **Usage estimates in** (checkboxes for the measures, a Usage estimate being given in them); each engine's caps under its name, in the engines list's order: **Window caps** (**5-hour window** and **7-day window**, in %, for an engine with Usage windows, with its own window's use and reset) and **Daily caps** (**Tokens a day**, **Dollars a day**; empty is off). **Save** and **Discard**; toast "Usage saved. The queue is weighed against the caps again."
- **Context policy** card: **Size threshold** (tokens): "Once a Thread's cache has cooled, an hour after its last call, its next message starts a fresh session with a Brief if the conversation has added more than this since the session began; below it, the session continues." Beside it **Soft limit** and **Hard limit** (tokens; defaults 100k and 180k; soft at least 50k, hard at least the soft plus 20k, in steps of 5k): "An Agent Stage's session is asked for a Handover note past the Soft limit and stopped past the Hard limit; a fresh session carries the Stage on." (`GET`/`PUT /settings/stage-context-limits`).
- **Archive** card: **Archive period** (days): "Done and Dropped Tasks finished longer ago than this are archived at the next daily run, …".
- **Run environments** card: **Run environments at once**, **CPUs per run environment** (**Automatic** or **Fixed**, the fixed number up to this computer's cores; a note says what Automatic gives here), **Memory per service** ("The most memory each service may use, with no swap."; in GB) and **Processes per service** ("The most processes each service may run at once."); each change sends the whole set; a change applies from each run environment's next start.
- The warning "Fewer run environments than running Tasks" shows when Run environments at once is below Running Tasks at once.
- **Test instances** card, under Run environments:
  - **Test instances at once** (a stepper, 1 to 6; "How many may be Building, Installing or Running together across The Office. Building and Installing count. Counted apart from run environments.");
  - **Idle time** (a stepper in minutes, 5 to 240 by 5; "A running test instance stops after this long with no request.");
  - **Proxy ports** (a first and a last port, with the count beside; "Each running test instance is opened at one of these ports on <OFFICE_HOST>. To reach them from another device on your network, The Office must listen on its LAN address and its firewall must let these ports in.");
  - each change sends the whole set (`PUT /settings/test-instances`): a stepper saves at each step, a port when its field loses focus or on Enter;
  - foot: "Running instances keep their port. Lowering Test instances at once stops none: the next launch waits until fewer are running.";
  - a refusal shows under the card, naming the field, and marks it ([Proxy ports' rules](../2.12-test-instances.md#proxy-ports)).
- **Actions** card, under Test instances:
  - **Actions at once** (a stepper, 1 to 6, 2 at first; "How many Project command runs of Actions may be running together across The Office. A Test target run counts as a test instance instead, a Workflow run toward neither.");
  - it saves at each step (`PUT /settings/actions`);
  - foot: "Lowering it stops none: the next start is refused until fewer are running.";
  - a refusal shows under the card.
  - Rules: [2.15](../2.15-actions.md#actions-at-once).
- Facts: [2.2](../2.2-people.md#limits), [2.5](../2.5-context-policy.md), [2.1.3](../2.1.3-tasks.md), [2.12](../2.12-test-instances.md#defaults), [2.15](../2.15-actions.md#defaults).

## Office instructions

- Card "Office instructions": one text box named "Office instructions" (hint "At most <N> words."), **Save** and **Discard**. Only what the user typed is held, so an untouched text follows changes made elsewhere and typing survives them; the text is compared and counted trimmed, and a text over the limit holds Save.
- Toast: "Office instructions saved. Sessions that start from now on get them." Refusal: "The Office instructions weren't saved".
- Facts: [2.2](../2.2-people.md#office-instructions).

## Prompt templates

- Route: `/settings/prompt-templates`; the tab and the open template are in the address (`domain`, `template`).
- Tabs, one per domain that has templates; a list of the domain's templates beside the open one; each row shows **Customised** and a warning mark while its saved text no longer passes the check. Under 1224px the list or the open one shows, with "All Prompt templates" to go back. Empty: "No Prompt template yet."
- The open template: its name with **Customised** or **Default** (who saved or reset it, and when), the stored problems as a warning ("The saved text no longer passes the check, so The Office uses the default until it is fixed."), a text box named "<name> text" (hint "At most <N> words."; compared exactly, no trimming), **Save**, **Discard**, **Reset to default** (confirms "Reset <name> to default?": "The saved text is replaced by the default that ships with The Office.") and "Variables", each as it is written ("This template uses no variables." when none).
- A refused save names each problem's line and column and keeps the typed text. Toasts: "Prompt template saved", "Prompt template reset to default".
- Facts: [2.2](../2.2-people.md#prompt-templates).

## Telemetry

- Card "Telemetry": "Where The Office sends its traces, metrics and logs, for a dashboard such as Grafana." Radio **Where telemetry goes**: **Off: nothing is exported**, **Bundled Grafana, on this computer at <endpoint>**, **Your own endpoint, over OTLP/HTTP**.
- Your own endpoint: **Endpoint URL** (hint "The OTLP/HTTP base address: /v1/traces, /v1/metrics and /v1/logs are added to it."), **Headers** (name and value rows; a saved value is never shown, an empty one keeps it; "None. Add one when the endpoint needs a key, such as Authorization."), **Export timeout** (hint "How long one export may take; empty is 10 seconds.").
- The Stats group: **Grafana read address** (hint "The Grafana your endpoint feeds."; an emptied address saves none) and **Read token** (never shown, kept while empty), **Test** ("Tries the address and token as typed, before Save."; answered "Grafana answered at <address>.", "Grafana refused the read token." or "Couldn't reach Grafana at <address>: <problem>") and **Remove** (toast "The Grafana read address was removed: Stats shows the basic stats.").
- "Applies the next time The Office starts." While what is saved isn't running yet, **Restart The Office** shows beside it ("A restart is scheduled." or that a scheduled update applies it, with a link to Settings › Updates; or the reason it is refused).
- Read-only with the alert "The environment sets telemetry" when the `OTEL_` variables set it.
- With Bundled Grafana saved, its state: "Bundled Grafana: Starting…" ("The first start pulls its image, which can take a few minutes."), "Bundled Grafana: Running" with **Open Grafana** (a new tab), or "Bundled Grafana: Couldn't start" with its problem and **Try again**; the earlier bundled Grafana The Office stopped is kept.
- The card is reused as First-run setup's last step.
- Facts: [2.11.2](../2.11.2-tokens-and-cost.md), [stats.md](stats.md).

## Updates

- **Version** card: the version The Office runs ("Current version"), how it was installed, **Check for updates** (a daily check installs nothing), "Update available" with the commits behind (or the newer versions with their notes, "This release has no notes.") and **Update**. Refusals: "The check couldn't fetch", "Update is refused", "The check failed", "The update wasn't scheduled".
- **Restart** card: **Restart The Office** ("Waits for the work going on, as an update does."); disabled with the refusal as its title and the warning "Restart is refused".
- A scheduled update or restart shows what it waits for (a list), "Meanwhile, new Starts join the queue and each Task waits before its next Stage.", and **Cancel**.
- **Last update** card: the last result with its log.
- Facts: [5.1.2](../5.1.2-updates-and-restarts.md), [5.1.1](../5.1.1-releases-and-installs.md).

## First-run setup

- Route: `/setup?step=engine|github|telemetry`, drawn outside the shell (no rail). It opens on the first run; **Skip the rest** and **Finish** close it (`POST /first-run-setup/close`) and go to `/now`.
- Heading "First-run setup": "A few basics before work starts. Each one can be skipped and set up later in Settings." A numbered list "Steps" and "Step N of 3".
- Steps: **Engine** ("The engine runs the sessions of The Office's people. Sign the Office default engine in now, or later in Settings › Engines."; card "Office default engine", its account sign-in, or a link to Settings › Engines for an API engine), **Sign in with GitHub** ("The Office's own git identity for GitHub over https …; Settings › Office identity has it later."), **Telemetry** ("Where The Office sends its traces, metrics and logs. Saving the choice finishes the setup; Settings › Telemetry changes it later.").
- Each step has **Skip** and **Next**; a refusal to close shows "First-run setup wasn't closed".
- Facts: [5.1](../5.1-shape.md#defaults).

## States

- Loading: a card draws nothing, or "Reading the engines…", until read; a failed read shows its problem alert.
- Narrow window: the menu stays beside the section; Pipelines and Prompt templates show the list or the open item (under 1224px).

## Domain facts

- Duties and Roles: [2.2](../2.2-people.md). Pipelines and Stage templates: [2.3](../2.3-pipelines.md).
- Skills: [2.6](../2.6-skills.md). Users and signing in: [2.10](../2.10-users-and-signing-in.md).
- Engines: [5.4](../5.4-the-engine.md). Updates and installs: [5.1](../5.1-shape.md).
