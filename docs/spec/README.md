# The Office: specification and knowledge base

The Office is an all-day workspace run like an office, for a few users who each sign in. The user hires people for Roles, and their Agents turn Ideas into published changes across the user's Projects while the user plans, steers and decides.

This spec is The Office's one source of truth, and the knowledge base Agents read about it. It describes The Office as it is.

## How to use it

- Find the concept or question in the [topic map](#topic-map) and open the one page and heading it links to.
- Each page opens with a "Covers:" line, has one `##` heading per concept, and one fact per bullet; its `## Defaults` come last and fill in what the body leaves open.
- A fact lives in one place; other pages link to it. Words are the [glossary](../../GLOSSARY.md)'s, used exactly.
- What the user sees: one page per screen, as built, in [screens/](#screens); [4](4-ux-direction.md) is the cross-screen direction and [4.1](4.1-ui-rules.md) the building rules.

## Topic map

### A

- **Account, Users, User**: [2.10 Users](2.10-users-and-signing-in.md#users); screen: [Account](screens/account.md#account-page)
- **adb key**: [2.13 The adb key](2.13-connected-devices.md#the-adb-key); [6 Connected devices](6-permissions-and-safety.md#connected-devices)
- **Agent**: [2.2 Agent](2.2-people.md#agent)
- **After publishing, Before publishing**: [2.3.4 Publish's before and after lines](2.3.4-publish.md#publishs-before-and-after-lines); screen: [Project page › Commands](screens/project-page.md#commands)
- **All clear**: [2.8 All clear](2.8-fire-alarm.md#all-clear); screen: [Now › The all clear's review](screens/now.md#the-all-clears-review)
- **Allow changes**: [2.4.1 Allow changes](2.4.1-threads.md#allow-changes); screen: [Thread › Allow changes bar](screens/thread.md#allow-changes-bar)
- **API endpoint, Search endpoint, Sees images, OpenAI-compatible API**: [5.4.2 The OpenAI-compatible API engine](5.4.2-openai-compatible-api-engine.md#the-openai-compatible-api-engine-is-the-offices-own-agent-loop); [5.4.5 An OpenAI-compatible API engine](5.4.5-engines-and-cascade.md#an-openai-compatible-api-engine)
- **Archive, Archived, Archive period, Restore**: [2.1.3 Archive](2.1.3-tasks.md#archive); screen: [Archived tab](screens/archived.md#archived-tab)
- **Ask me again, Asked again**: [2.4.2 Sending a Decision](2.4.2-decisions.md#sending-a-decision); screen: [Decision card › Ask me again](screens/decision-card.md#ask-me-again)
- **Attachment**: [2.1.2 Attachment](2.1.2-ideas-and-attachments.md#attachment); screen: [Task page › Attachments tab](screens/task-page.md#attachments-tab)
- **Authenticator**: [2.10 The authenticator](2.10-users-and-signing-in.md#the-authenticator); screen: [Account › Authenticator](screens/account.md#authenticator)
- **Auto mode**: [2.1.5 Auto mode](2.1.5-planning-and-start.md#auto-mode)
- **Avatar**: [2.2 Avatar](2.2-people.md#avatar)

### B

- **Back to Shaping**: [2.1.4 Back to Shaping](2.1.4-initiatives.md#back-to-shaping); screen: [Initiative page › Back to Shaping](screens/initiative-page.md#back-to-shaping)
- **Base Pipeline, Stage change**: [2.3.5 Project Pipelines](2.3.5-library.md#project-pipelines); screen: [Pipeline flow editor › In a Project Pipeline](screens/pipeline-flow-editor.md#in-a-project-pipeline)
- **Basic stats, Full stats**: [2.11.2 Basic stats](2.11.2-tokens-and-cost.md#basic-stats); [2.11.2 Full stats](2.11.2-tokens-and-cost.md#full-stats)
- **Brief**: [2.5 The Brief](2.5-context-policy.md#the-brief)
- **Broken, Broken Pipeline**: [2.3.5 A Broken Project Pipeline](2.3.5-library.md#a-broken-project-pipeline); screen: [Task page › Broken Pipeline flag](screens/task-page.md#broken-pipeline-flag)
- **Bug Task Decision**: [2.4.2 The Bug Task Decision](2.4.2-decisions.md#the-bug-task-decision); screen: [Decision card › The Bug Task card](screens/decision-card.md#the-bug-task-card)

### C

- **Caused by, Found in version, Found while working on**: [2.1.3 Bug details](2.1.3-tasks.md#bug-details); screen: [Task page › Bug](screens/task-page.md#bug)
- **Caretaker**: [2.2 Caretaker](2.2-people.md#caretaker); [6 The Caretaker with Allow changes on](6-permissions-and-safety.md#the-caretaker-with-allow-changes-on)
- **CI run, Workflow**: [2.1.6 The CI tab](2.1.6-board-and-search.md#the-ci-tab); screen: [CI tab › Start a workflow window](screens/ci-runs.md#start-a-workflow-window)
- **Chat drawer**: [4.1 The chat drawer](4.1-ui-rules.md#the-chat-drawer); screen: [Shell › The chat drawer](screens/shell.md#the-chat-drawer)
- **Checks**: [2.3.3 Gates](2.3.3-gates-and-checks.md#gates); [2.3.4 Publish](2.3.4-publish.md#publish); screen: [Pull requests › Table](screens/pull-requests.md#table)
- **Choice, Question, Open question, Comment, General comment, Submit**: [2.4.2 The Decision form](2.4.2-decisions.md#the-decision-form); screen: [Decision card › Submit](screens/decision-card.md#submit)
- **Command kind, Project command**: [2.1.1 Project commands](2.1.1-projects.md#project-commands); screen: [Project page › Commands](screens/project-page.md#commands)
- **Commit message**: [2.1.3 Commit message](2.1.3-tasks.md#commit-message); [2.3.4 The Task's commit message](2.3.4-publish.md#the-tasks-commit-message); screen: [Task page › Commit message](screens/task-page.md#commit-message)
- **Compose install, Direct install**: [5.1.1 Installing with Docker Compose](5.1.1-releases-and-installs.md#installing-with-docker-compose); [5.1.1 Installing on Debian/Ubuntu](5.1.1-releases-and-installs.md#installing-on-debianubuntu)
- **Condition, Route, Not taken**: [2.3.2 Which route the walk follows](2.3.2-flows.md#which-route-the-walk-follows); [2.3.2 Built-in conditions](2.3.2-flows.md#built-in-conditions); screen: [Pipeline flow editor › Condition builder](screens/pipeline-flow-editor.md#condition-builder)
- **Confirm, Save**: [4.1 A step before an action](4.1-ui-rules.md#a-step-before-an-action)
- **Conflict resolution Task**: [2.1.3 Conflict resolution Tasks](2.1.3-tasks.md#conflict-resolution-tasks); [2.3.4 Conflicts at Publish](2.3.4-publish.md#conflicts-at-publish); screen: [Pull requests › Resolve conflicts](screens/pull-requests.md#resolve-conflicts)
- **Connected device, device key, Waiting for the run environment, Disconnected reasons**: [2.13 Connected device](2.13-connected-devices.md#connected-device); [2.13 One device to one Task](2.13-connected-devices.md#one-device-to-one-task); [2.13 States](2.13-connected-devices.md#states); [2.13 Lifecycle](2.13-connected-devices.md#lifecycle); [6 Connected devices](6-permissions-and-safety.md#connected-devices); screen: [Task page › Devices](screens/task-page.md#devices)
- **Consultant, Consultation**: [2.4.3 Consultation](2.4.3-consultations.md#consultation); [2.2 Calls](2.2-people.md#calls)
- **Continue with GitHub, Continue with Google, Continue with <name>, OpenID Connect provider**: [2.10 Continue with GitHub](2.10-users-and-signing-in.md#continue-with-github); [2.10 Continue with an OpenID Connect provider](2.10-users-and-signing-in.md#continue-with-an-openid-connect-provider); screen: [Sign in › Ways to sign in](screens/sign-in.md#ways-to-sign-in)
- **CPU limit, Run environments at once**: [5.5 The CPU limit](5.5-git-and-isolation.md#the-cpu-limit); [5.5 The other limits of run environments](5.5-git-and-isolation.md#the-other-limits-of-run-environments)

### D

- **Daily cap, Window cap, Usage window**: [2.1.5 A pause by the usage window](2.1.5-planning-and-start.md#a-pause-by-the-usage-window); [5.4.6 Checking the usage windows](5.4.6-stand-in-engines-and-usage-windows.md#checking-the-usage-windows)
- **Decision**: [2.4.2 The Decision form](2.4.2-decisions.md#the-decision-form); screen: [Decision card](screens/decision-card.md#decision-card)
- **Definition of Done, Plan**: [2.1.5 Plan and Definition of Done](2.1.5-planning-and-start.md#plan-and-definition-of-done); screen: [Task page › Definition of Done](screens/task-page.md#definition-of-done)
- **Density**: [4 Densities](4-ux-direction.md#densities); [4 Density](4-ux-direction.md#density)
- **Description**: [2.1.3 Description](2.1.3-tasks.md#description)
- **Details**: [2.9.3 The details](2.9.3-streaming-and-ui.md#the-details); screen: [Decision card › The details window](screens/decision-card.md#the-details-window-open-details)
- **Devices section, Connect over USB, Pair over wireless debugging**: [2.13 Two ways to connect](2.13-connected-devices.md#two-ways-to-connect); [2.13 Who connects](2.13-connected-devices.md#who-connects); screen: [Task page › Devices](screens/task-page.md#devices)
- **Drop reason**: [2.1.3 Drop reason](2.1.3-tasks.md#drop-reason); screen: [Task page › Task menu](screens/task-page.md#task-menu); [Archived tab › Archived Tasks](screens/archived.md#archived-tasks)
- **Dismiss, Dismissed**: [2.4.2 Dismiss](2.4.2-decisions.md#sending-a-decision); screen: [Decision card › Dismiss](screens/decision-card.md#dismiss)
- **Duty**: [2.2 Duty](2.2-people.md#duty); [2.2 Duties](2.2-people.md#duties); screen: [Settings › Duties](screens/settings.md#duties)

### E

- **End, Final Stage**: [2.3.1 How a Stage ends](2.3.1-stages.md#how-a-stage-ends); [2.3.2 The Pipeline's order](2.3.2-flows.md#the-pipelines-order)
- **Engine, Office default, Project default, Role override**: [5.4.5 Engines are a list](5.4.5-engines-and-cascade.md#engines-are-a-list); [5.4.5 The engine cascade](5.4.5-engines-and-cascade.md#the-engine-cascade); screen: [Settings › Engines](screens/settings.md#engines)

### F

- **Files to change**: [2.1.4 Initiative](2.1.4-initiatives.md#initiative); screen: [Task page › Overview](screens/task-page.md#overview)
- **Fire alarm, Sound the alarm**: [2.8 The alarm](2.8-fire-alarm.md#the-alarm); screen: [Shell › Fire alarm control](screens/shell.md#fire-alarm-control)
- **First-run setup**: [2.10 First-run setup](2.10-users-and-signing-in.md#first-run-setup); screen: [Sign in › First user](screens/sign-in.md#first-user)

### G

- **Gate**: [2.3.3 Gates](2.3.3-gates-and-checks.md#gates); screen: [Task page › Gate](screens/task-page.md#gate)
- **GitHub issue, Import issues, auto-import**: [2.1.1 GitHub issues](2.1.1-projects.md#github-issues); [2.3.4 The Task's commit message](2.3.4-publish.md#the-tasks-commit-message) (`Fixes #n`); screen: [Project page › GitHub issues](screens/project-page.md#github-issues)
- **Grafana read address, Read token**: [5.2 Stats reads Grafana](5.2-stack.md#stats-reads-grafana); [5.2 The bundled Grafana](5.2-stack.md#the-bundled-grafana)

### H

- **Handover note**: [2.5 Handover note](2.5-context-policy.md#handover-note); screen: [Thread › Handover note prefilled](screens/thread.md#handover-note-prefilled)
- **Hard switch**: [6 Hard switches](6-permissions-and-safety.md#hard-switches); [2.2 Authority and Hard switches](2.2-people.md#authority-and-hard-switches)
- **Health reading, Statement shape**: [2.11.3 System health](2.11.3-system-health.md#system-health); [2.11.3 Routes are named by their template, statements by their shape](2.11.3-system-health.md#routes-are-named-by-their-template-statements-by-their-shape)

### I

- **Icon, Logo**: [2.1.1 Icon and Logo](2.1.1-projects.md#icon-and-logo); screen: [Project page › Appearance](screens/project-page.md#appearance)
- **Idea**: [2.1.2 Idea](2.1.2-ideas-and-attachments.md#idea); screen: [Ideas tab](screens/ideas.md#ideas-tab)
- **Initiative, Short name**: [2.1.4 Initiative](2.1.4-initiatives.md#initiative); screen: [Initiative page](screens/initiative-page.md#initiative-page)
- **Initiative's branch**: [5.5 The Initiative's branch](5.5-git-and-isolation.md#the-initiatives-branch); [2.3.4 Publishing into an Initiative's branch](2.3.4-publish.md#publishing-into-an-initiatives-branch)
- **Initiative's Pipeline**: [2.1.4 An Initiative's Pipeline](2.1.4-initiatives.md#an-initiatives-pipeline); screen: [Initiative page › Pipelines block](screens/initiative-page.md#pipelines-block)
- **Install inputs**: [5.5 Install inputs](5.5-git-and-isolation.md#install-inputs)

### J

- **Join, Walk**: [2.3.2 A Pipeline is a flow](2.3.2-flows.md#a-pipeline-is-a-flow); [2.3.2 The Pipeline's order](2.3.2-flows.md#the-pipelines-order)

### K

- **Knowledge base**: [6 The knowledge base](6-permissions-and-safety.md#the-knowledge-base); [2.5 The Brief](2.5-context-policy.md#the-brief)

### L

- **Language server**: [5.4.1 Language servers for Agents](5.4.1-engine-kinds.md#language-servers-for-agents); [6 Language servers run Project code](6-permissions-and-safety.md#language-servers-run-project-code)
- **Launcher, Office updater**: [5.1.2 Updating The Office](5.1.2-updates-and-restarts.md#updating-the-office); [5.1.2 Restarting The Office](5.1.2-updates-and-restarts.md#restarting-the-office)
- **Link card, Office status**: [2.2 What each person is doing now](2.2-people.md#what-each-person-is-doing-now); screen: [Thread › Lines and cards in the log](screens/thread.md#lines-and-cards-in-the-log)
- **Linked identity**: [2.10 Linking](2.10-users-and-signing-in.md#linking); screen: [Account › Linked identities](screens/account.md#linked-identities)
- **Live view**: screen: [Live view](screens/live-view.md#live-view); [2.2 A person's headline state on the Live view](2.2-people.md#a-persons-headline-state-on-the-live-view)
- **Lockout**: [2.10 Slow-down and lockout](2.10-users-and-signing-in.md#slow-down-and-lockout); [2.10 Wrong tries](2.10-users-and-signing-in.md#wrong-tries)

### M

- **Mark**: [4 Project mark](4-ux-direction.md#project-mark); [4.1 Marks and their words](4.1-ui-rules.md#marks-and-their-words); screen: [Work board › Marks](screens/work-board.md#marks)
- **MCP server**: [5.4.1 MCP servers for Agents](5.4.1-engine-kinds.md#mcp-servers-for-agents); [5.3 MCP servers is its own module](5.3-modules.md#mcp-servers-is-its-own-module); screen: [Settings › MCP servers](screens/settings.md#mcp-servers)
- **Memory, Memory note**: [2.2 Shared memory](2.2-people.md#shared-memory); screen: [People › Memory tab](screens/people.md#memory-tab)
- **Mention**: [2.4.4 Mentions](2.4.4-messages.md#mentions); screen: [Thread › Mentions](screens/thread.md#mentions)
- **Merge method**: [2.3.4 Publish](2.3.4-publish.md#publish); screen: [Pull requests › Merge window](screens/pull-requests.md#merge-window)
- **Model price**: [2.11.2 Estimated cost](2.11.2-tokens-and-cost.md#estimated-cost); [5.2 Estimated cost](5.2-stack.md#estimated-cost)
- **Move**: [2.1.3 Moving a Task](2.1.3-tasks.md#moving-a-task); screen: [Task page › Move to another Project](screens/task-page.md#move-to-another-project)

### N

- **Notification**: [2.7 A Notification](2.7-notifications.md#a-notification); [2.7 Kinds](2.7-notifications.md#kinds)

### O

- **Office action**: [2.4.4 Office actions in Threads](2.4.4-messages.md#office-actions-in-threads); [5.4.1 Office actions](5.4.1-engine-kinds.md#office-actions)
- **Office command, Skill command**: [2.4.4 Commands in the message box](2.4.4-messages.md#commands-in-the-message-box); [2.6 Skill commands](2.6-skills.md#skill-commands); screen: [Thread › Commands](screens/thread.md#commands)
- **Office device helper, the relay**: [2.13 The relay](2.13-connected-devices.md#the-relay); [2.13 The helper's start and stop](2.13-connected-devices.md#the-helpers-start-and-stop); [2.13 What the image needs](2.13-connected-devices.md#what-the-image-needs); [5.5 The Office device helper in a run environment](5.5-git-and-isolation.md#the-office-device-helper-in-a-run-environment); [5.3 Devices uses Run environments through their public interface](5.3-modules.md#devices-uses-run-environments-through-their-public-interface)
- **Office identity, Office ssh key, Trusted host, Unconfirmed host, Sign in with GitHub**: [5.5 The Office identity](5.5-git-and-isolation.md#the-office-identity); [2.3.4 The Office's own credentials for publishing](2.3.4-publish.md#the-offices-own-credentials-for-publishing); screen: [Settings › Office identity](screens/settings.md#office-identity)
- **Office instructions**: [2.2 Office instructions](2.2-people.md#office-instructions); screen: [Settings › Office instructions](screens/settings.md#office-instructions)
- **Office Manager**: [2.2 Office Manager](2.2-people.md#office-manager)
- **OFFICE_CONNECTED_DEVICES, ANDROID_SERIAL**: [2.13 What Agents see](2.13-connected-devices.md#what-agents-see); [5.5 The Office device helper in a run environment](5.5-git-and-isolation.md#the-office-device-helper-in-a-run-environment)
- **Office release, Office update, Office restart**: [5.1.1 Released versions](5.1.1-releases-and-installs.md#released-versions); [5.1.2 Updating The Office](5.1.2-updates-and-restarts.md#updating-the-office); [5.1.2 Restarting The Office](5.1.2-updates-and-restarts.md#restarting-the-office)
- **Office-wide Pipeline, Pipeline library**: [2.3.5 Library](2.3.5-library.md#library); screen: [Settings › Pipelines](screens/settings.md#pipelines)
- **Onboarding**: [2.1.1 Onboarding a Project](2.1.1-projects.md#onboarding-a-project); screen: [Project page › Onboarding](screens/project-page.md#onboarding)
- **One-time password**: [2.10 The one-time password](2.10-users-and-signing-in.md#the-one-time-password)
- **Open page**: [2.4.4 Open page](2.4.4-messages.md#open-page); screen: [Thread › Open page](screens/thread.md#open-page)
- **Out of reach, Reported met**: [2.3.3 Statements Out of reach](2.3.3-gates-and-checks.md#statements-out-of-reach); [2.3.3 Reports count across Stages](2.3.3-gates-and-checks.md#reports-count-across-stages-and-the-check-runs-before-publish)
- **Overlap**: [2.1.5 Overlaps at Start](2.1.5-planning-and-start.md#overlaps-at-start)

### P

- **Palette**: [4 Palettes](4-ux-direction.md#palettes); [4 Palette](4-ux-direction.md#palette); screen: [Shell › Theme menu](screens/shell.md#theme-menu)
- **Passkey**: [2.10 Ways to sign in](2.10-users-and-signing-in.md#ways-to-sign-in); screen: [Account › Passkeys](screens/account.md#passkeys)
- **Pause the Initiative, Resume the Initiative**: [2.1.4 Pause the Initiative](2.1.4-initiatives.md#pause-the-initiative); [2.8 The alarm and an Initiative's Pause](2.8-fire-alarm.md#the-alarm-and-an-initiatives-pause)
- **Pinned version, Source, Update (skills)**: [2.6 The pinned version](2.6-skills.md#the-pinned-version); [2.6 Installing from a source](2.6-skills.md#installing-from-a-source); [2.6 Updates are flagged, then proposed](2.6-skills.md#updates-are-flagged-then-proposed)
- **Pipeline**: [2.3.2 A Pipeline is a flow](2.3.2-flows.md#a-pipeline-is-a-flow); screen: [Pipeline flow editor](screens/pipeline-flow-editor.md#pipeline-flow-editor)
- **Pipeline rail**: screen: [Task page › Pipeline rail](screens/task-page.md#pipeline-rail)
- **Plan the Initiative**: [2.1.4 Plan the Initiative](2.1.4-initiatives.md#plan-the-initiative)
- **Process, Sub-agent**: [2.9.1 Sub-agents and Processes](2.9.1-the-model.md#sub-agents-and-processes); screen: [Thread › Sub-agents and Processes](screens/thread.md#sub-agents-and-processes)
- **Project**: [2.1.1 Project](2.1.1-projects.md#project); screen: [Projects page](screens/projects.md#projects-page-and-add-a-project)
- **Project filter**: [2.1.6 Saved views and the Project filter](2.1.6-board-and-search.md#saved-views-and-the-project-filter); screen: [Shell › Project filter](screens/shell.md#project-filter)
- **Project limit, Task limit**: [2.1.1 Project limit](2.1.1-projects.md#project-limit); [2.2 Limits](2.2-people.md#limits)
- **Project Pipeline**: [2.3.5 Project Pipelines](2.3.5-library.md#project-pipelines); screen: [Project page › Pipelines](screens/project-page.md#pipelines)
- **Prompt template**: [2.2 Prompt templates](2.2-people.md#prompt-templates); [5.3 Prompt templates is its own module](5.3-modules.md#prompt-templates-is-its-own-module); screen: [Settings › Prompt templates](screens/settings.md#prompt-templates)
- **Proposal**: [2.3.2 Route and condition Proposals](2.3.2-flows.md#route-and-condition-proposals); [2.3.5 Project commands by Proposal and by hand](2.3.5-library.md#project-commands-by-proposal-and-by-hand); screen: [Task page › Pipeline proposal](screens/task-page.md#pipeline-proposal)
- **Public address**: [5.1 The public address](5.1-shape.md#the-public-address); [2.10 Which ways work on which address](2.10-users-and-signing-in.md#which-ways-work-on-which-address)
- **Publishing Task**: [2.1.4 Publishing Tasks](2.1.4-initiatives.md#publishing-tasks); [2.3.4 A Publishing Task's Publish](2.3.4-publish.md#a-publishing-tasks-publish)
- **Pull request**: [2.3.4 The Office records the pull requests it opens](2.3.4-publish.md#the-office-records-the-pull-requests-it-opens-and-refreshes-them-every-minute); [2.1.6 The Pull requests tab](2.1.6-board-and-search.md#the-pull-requests-tab); screen: [Pull requests tab](screens/pull-requests.md#pull-requests-tab)

### Q

- **Queue, Short reason**: [2.1.5 A queue for Start](2.1.5-planning-and-start.md#a-queue-for-start); screen: [Work board › Queue for Start](screens/work-board.md#queue-for-start)
- **Quiet hours**: [2.7 Quiet hours hold the desktop](2.7-notifications.md#quiet-hours-hold-the-desktop); screen: [Settings › Notifications](screens/settings.md#notifications)

### R

- **Re-run command**: [2.1.1 The re-run command](2.1.1-projects.md#the-re-run-command); screen: [Project page › Commands](screens/project-page.md#commands)
- **Recovery code**: [2.10 Recovery codes](2.10-users-and-signing-in.md#recovery-codes); screen: [Account › Recovery codes](screens/account.md#recovery-codes)
- **Repository file browser**: screen: [Project page › Files](screens/project-page.md#files)
- **Repository URL**: [5.5 Clones](5.5-git-and-isolation.md#clones); screen: [Projects › A git URL](screens/projects.md#a-git-url)
- **Request**: [2.2 Calls](2.2-people.md#calls); [2.4.3 Calls from chats](2.4.3-consultations.md#calls-from-chats)
- **Resolve**: [2.3.4 Conflicts at Publish](2.3.4-publish.md#conflicts-at-publish); screen: [Pull requests › Resolve conflicts](screens/pull-requests.md#resolve-conflicts)
- **Role, Role card**: [2.2 Role](2.2-people.md#role); [2.2 Role card](2.2-people.md#role-card); screen: [People › Role card tab](screens/people.md#role-card-tab)
- **Run environment**: [2.3.1 Script Stages in the run environment](2.3.1-stages.md#script-stages-in-the-run-environment); [5.5 Writing the run environment definition](5.5-git-and-isolation.md#writing-the-run-environment-definition); screen: [Project page › Run environment](screens/project-page.md#run-environment)

### S

- **Saved view**: [2.1.6 Saved views and the Project filter](2.1.6-board-and-search.md#saved-views-and-the-project-filter); screen: [Work board › Saved views](screens/work-board.md#saved-views)
- **Secret variable, Server value**: [5.5 Secret variables](5.5-git-and-isolation.md#secret-variables); [6 Secret variables](6-permissions-and-safety.md#secret-variables); screen: [Project page › Server values](screens/project-page.md#server-values)
- **Setup token**: [2.10 The setup token](2.10-users-and-signing-in.md#the-setup-token)
- **Shaping**: [2.1.4 Shaping without a CTO](2.1.4-initiatives.md#shaping-without-a-cto); [2.1.4 Initiative states](2.1.4-initiatives.md#initiative-states); screen: [Initiatives tab › Shaping card](screens/initiatives-tab.md#shaping-card)
- **Sign out, Signed-in device**: [2.10 Signed-in devices](2.10-users-and-signing-in.md#signed-in-devices); screen: [Account › Signed-in devices](screens/account.md#signed-in-devices)
- **Skill**: [2.6 The library](2.6-skills.md#the-library); screen: [Settings › Skills](screens/settings.md#skills)
- **Skill use**: [2.6 Skill uses](2.6-skills.md#skill-uses); [2.6 A skill use](2.6-skills.md#a-skill-use)
- **Stage**: [2.3.1 Stage kinds](2.3.1-stages.md#stage-kinds); [2.3.1 What a Stage declares](2.3.1-stages.md#what-a-stage-declares)
- **Stage history**: [2.4.6 Reading the Stage history](2.4.6-reading-records.md#reading-the-stage-history); screen: [Task page › Stage history](screens/task-page.md#stage-history)
- **Stage retry**: [2.3.2 When a Stage fails](2.3.2-flows.md#when-a-stage-fails); [2.3.2 On failure](2.3.2-flows.md#on-failure)
- **Stage template**: [2.3.5 Stage templates](2.3.5-library.md#stage-templates); screen: [Pipeline flow editor › Stage templates](screens/pipeline-flow-editor.md#stage-templates)
- **Stand-in Engine**: [5.4.6 Stand-in Engines](5.4.6-stand-in-engines-and-usage-windows.md#stand-in-engines); [5.4.6 A person's Thread switches](5.4.6-stand-in-engines-and-usage-windows.md#a-persons-thread-switches)
- **Start anyway past the usage caps**: [2.1.5 Start anyway past the usage caps](2.1.5-planning-and-start.md#start-anyway-past-the-usage-caps); screen: [Task page › Start and the queue](screens/task-page.md#start-and-the-queue)
- **Start Ready Tasks**: [2.1.4 Start Ready Tasks](2.1.4-initiatives.md#start-ready-tasks); screen: [Work board › Start Ready Tasks](screens/work-board.md#start-ready-tasks)
- **Stats**: [2.11.1 What Stats shows](2.11.1-the-stats-page.md#what-stats-shows); screen: [Stats](screens/stats.md#stats)

### T

- **Tag**: [2.1.3 Tags](2.1.3-tasks.md#tags)
- **Test target, Hosted, Build to install, Install on a device, Deployed elsewhere, entry points only**: [2.12 Test target](2.12-test-instances.md#test-target); [2.12 Kinds](2.12-test-instances.md#kinds); [2.12 Entry points only](2.12-test-instances.md#entry-points-only); screen: [Project page › Test targets](screens/project-page.md#test-targets)
- **propose_test_targets, Set up test targets**: [2.12 Writing test targets](2.12-test-instances.md#writing-test-targets); [2.12 Set up test targets](2.12-test-instances.md#set-up-test-targets); [2.3.5 Built-ins](2.3.5-library.md#built-ins)
- **Test instance, launching on a branch, linked to an Initiative, Building, Running, Stopped, Built, Failed**: [2.12 Test instance](2.12-test-instances.md#test-instance); [2.12 Linking to an Initiative](2.12-test-instances.md#linking-to-an-initiative); [2.12 Test instance states](2.12-test-instances.md#test-instance-states); [2.1.4 Test instances of an Initiative](2.1.4-initiatives.md#test-instances-of-an-initiative); screens: [Initiative page › Test instances](screens/initiative-page.md#test-instances), [Project page › Test instances](screens/project-page.md#test-instances)
- **Test instance proxy, hand-off link, Proxy ports**: [2.12 Reaching a Hosted instance](2.12-test-instances.md#reaching-a-hosted-instance); [5.1 The test instance proxy](5.1-shape.md#the-test-instance-proxy); [2.10 Signing in to a test instance](2.10-users-and-signing-in.md#signing-in-to-a-test-instance)
- **Build to install files, QR code link, build time, Kept Build to install files (linked and unlinked builds)**: [2.12 Build to install](2.12-test-instances.md#build-to-install); [2.12 Kept Build to install files](2.12-test-instances.md#kept-build-to-install-files); [2.12 Build time](2.12-test-instances.md#build-time); [5.5 The build cache volume](5.5-git-and-isolation.md#the-build-cache-volume)
- **Build cache volume**: [5.5 The build cache volume](5.5-git-and-isolation.md#the-build-cache-volume)
- **Build to install QR link**: [2.12 Build to install](2.12-test-instances.md#build-to-install); [2.10 What every request needs](2.10-users-and-signing-in.md#what-every-request-needs)
- **Test instances at once, Idle time**: [2.12 Test instances at once](2.12-test-instances.md#test-instances-at-once); [2.12 Idle time](2.12-test-instances.md#idle-time); screen: [Settings › Office limits](screens/settings.md#office-limits)
- **Test target commands before the entry point, port variable, what The Office sets**: [2.12 Commands before the entry point](2.12-test-instances.md#commands-before-the-entry-point); [2.12 What The Office sets](2.12-test-instances.md#what-the-office-sets); [5.5 A test instance's checkout](5.5-git-and-isolation.md#a-test-instances-checkout); screen: [Project page › Test targets](screens/project-page.md#test-targets)
- **Test target Memory per service, tool settings (Gradle memory)**: [2.12 A target's memory](2.12-test-instances.md#a-targets-memory); [2.12 Tool settings](2.12-test-instances.md#tool-settings); [5.5 The other limits of run environments](5.5-git-and-isolation.md#the-other-limits-of-run-environments)
- **Test instance safety, OFFICE_TEST_INSTANCE, Test instance banner**: [6 Test instances](6-permissions-and-safety.md#test-instances); [2.12 Safety](2.12-test-instances.md#safety); screen: [The shell › Test instance banner](screens/shell.md#test-instance-banner)
- **Task**: [2.1.3 Task](2.1.3-tasks.md#task); screen: [Task page](screens/task-page.md#task-page)
- **Task kind (Feature, Bug, Chore), a Kind's default Pipeline**: [2.1.3 Task kind](2.1.3-tasks.md#task-kind); [2.1.1 Project settings](2.1.1-projects.md#project-settings); screen: [Work board › Marks](screens/work-board.md#marks)
- **Text file**: [2.1.2 Text files and PDFs](2.1.2-ideas-and-attachments.md#text-files-and-pdfs)
- **Thread**: [2.4.1 Threads](2.4.1-threads.md#threads); screen: [Thread view](screens/thread.md#thread-view)
- **Tokens and cost**: [2.11.2 Tokens and cost](2.11.2-tokens-and-cost.md#levels); screen: [Stats › Tokens and estimated cost over time](screens/stats.md#tokens-and-estimated-cost-over-time)
- **Turn**: [2.4.4 Barge-in](2.4.4-messages.md#barge-in); [2.4.5 Stop and Pause](2.4.5-stopping-and-restarts.md#stop-and-pause)

### U

- **Usage estimate**: [2.1.5 Usage estimates](2.1.5-planning-and-start.md#usage-estimates)

### W

- **Workstation figure**: [4 Densities](4-ux-direction.md#densities); screen: [Shell › Workstation figure](screens/shell.md#workstation-figure)

### Questions Agents ask

- **Archive and restore a Task**: [2.1.3 Archive](2.1.3-tasks.md#archive)
- **Cache breakers**: [5.4.1 Cache breakers](5.4.1-engine-kinds.md#cache-breakers)
- **Commit message convention**: [2.3.4 The Task's commit message](2.3.4-publish.md#the-tasks-commit-message); [2.1.3 Commit message](2.1.3-tasks.md#commit-message)
- **Context policy (resume, fresh or hand off)**: [2.5 The three moves](2.5-context-policy.md#the-three-moves); [2.5 Choosing a move](2.5-context-policy.md#choosing-a-move)
- **Context limits (Soft limit, Hard limit)**: [2.5 A Stage's session has a Soft limit and a Hard limit](2.5-context-policy.md#a-stages-session-has-a-soft-limit-and-a-hard-limit); [2.3.1 A Stage run restarts in a fresh session at its limits](2.3.1-stages.md#a-stage-run-restarts-in-a-fresh-session-at-its-limits); screen: [Settings › Office limits](screens/settings.md#office-limits)
- **Crash loop**: [2.4.5 Crash loop](2.4.5-stopping-and-restarts.md#crash-loop)
- **Dependencies between Tasks**: [2.1.3 Dependencies](2.1.3-tasks.md#dependencies); [2.1.3 A Dropped blocker](2.1.3-tasks.md#a-dropped-blocker)
- **Engine kinds**: [5.4.1 Engine kinds](5.4.1-engine-kinds.md#engine-kinds); [5.4.1 The AgentEngine port](5.4.1-engine-kinds.md#the-agentengine-port)
- **Escalation and calls between people**: [2.2 Escalation](2.2-people.md#escalation); [2.2 Chains of calls](2.2-people.md#chains-of-calls)
- **Hard switches by Role**: [6 Hard switches by role](6-permissions-and-safety.md#hard-switches-by-role); [6 Default profiles](6-permissions-and-safety.md#default-profiles)
- **How a Stage ends**: [2.3.1 How a Stage ends](2.3.1-stages.md#how-a-stage-ends)
- **Manual order and priority**: [2.1.3 Priority and order](2.1.3-tasks.md#priority-and-order)
- **Mark Ready**: [2.1.3 Ready](2.1.3-tasks.md#ready); [2.1.3 Mark Ready](2.1.3-tasks.md#mark-ready); screen: [Task page › Before Ready](screens/task-page.md#before-ready)
- **Migrations keep the previous release working**: [5.1.2 Updating The Office](5.1.2-updates-and-restarts.md#updating-the-office)
- **Modules and boundaries**: [5.3 Architecture](5.3-modules.md#architecture); [5.3 The modules](5.3-modules.md#the-modules)
- **Notification kinds and channels**: [2.7 Kinds](2.7-notifications.md#kinds); [2.7 Channels](2.7-notifications.md#channels); [2.7 Office kinds](2.7-notifications.md#office-kinds)
- **Office data directory**: [5.2 Data](5.2-stack.md#data); [5.1 The service](5.1-shape.md#the-service)
- **Operating systems (Windows and Linux)**: [5.1 Operating systems](5.1-shape.md#operating-systems); [5.1 Windows and Linux](5.1-shape.md#windows-and-linux)
- **Only hashes are stored**: [6 Only hashes are stored](6-permissions-and-safety.md#only-hashes-are-stored)
- **Permissions: the two layers and the threat model**: [6 Threat model](6-permissions-and-safety.md#threat-model); [6 Two layers](6-permissions-and-safety.md#two-layers)
- **Publish**: [2.3.4 Publish](2.3.4-publish.md#publish); [2.3.4 Merge mode when the base moved](2.3.4-publish.md#merge-mode-when-the-base-moved)
- **Releases and installs**: [5.1.1 Released versions](5.1.1-releases-and-installs.md#released-versions)
- **Restarting The Office**: [5.1.2 Restarting The Office](5.1.2-updates-and-restarts.md#restarting-the-office); [2.4.5 Restarting](2.4.5-stopping-and-restarts.md#restarting)
- **Sign-in ways**: [2.10 Ways to sign in](2.10-users-and-signing-in.md#ways-to-sign-in); screen: [Sign in › Ways to sign in](screens/sign-in.md#ways-to-sign-in)
- **Skipping a Stage**: [2.3.1 Skipping](2.3.1-stages.md#skipping)
- **Review & fix Stage**: [2.3.1 Review & fix Stage](2.3.1-stages.md#review--fix-stage)
- **Stop and Pause a Task**: [2.4.5 Stop and Pause](2.4.5-stopping-and-restarts.md#stop-and-pause)
- **Task states**: [2.1.3 Task states](2.1.3-tasks.md#task-states)
- **Telemetry, traces, metrics and logs**: [5.2 Telemetry](5.2-stack.md#telemetry); [5.2 The telemetry setting](5.2-stack.md#the-telemetry-setting)
- **Themes and palettes**: [4 Palettes](4-ux-direction.md#palettes); [4 Palette](4-ux-direction.md#palette)
- **Updating The Office**: [5.1.2 Updating The Office](5.1.2-updates-and-restarts.md#updating-the-office)
- **Usage windows and pauses**: [5.4.6 A turn refused for a used-up usage window](5.4.6-stand-in-engines-and-usage-windows.md#a-turn-refused-for-a-used-up-usage-window); [2.4.5 A turn refused for the usage window](2.4.5-stopping-and-restarts.md#a-turn-refused-for-the-usage-window); [2.7 A usage window used up](2.7-notifications.md#a-usage-window-used-up)
- **What a Stage gets (its message and Brief)**: [2.3.1 An Agent Stage's message names the Stages after it](2.3.1-stages.md#an-agent-stages-message-names-the-stages-after-it); [2.5 The Brief](2.5-context-policy.md#the-brief)
- **What a Thread reads**: [2.4.1 What a Thread reads](2.4.1-threads.md#what-a-thread-reads); [2.5 A chat Thread's Brief](2.5-context-policy.md#a-chat-threads-brief)
- **What a session gets (skills)**: [2.6 What a session gets](2.6-skills.md#what-a-session-gets); [5.6 What a session must list at start](5.6-skills-per-session.md#what-a-session-must-list-at-start)
- **Who is asked on failure**: [2.3.2 Who is asked](2.3.2-flows.md#who-is-asked); [2.3.2 The holder of Asked first on failures](2.3.2-flows.md#the-holder-of-asked-first-on-failures)
- **Who did what**: [2.1.3 Who did what](2.1.3-tasks.md#who-did-what); [2.4.1 Who wrote it](2.4.1-threads.md#who-wrote-it)
- **Window sizes (UI)**: [4.1 Window sizes](4.1-ui-rules.md#window-sizes); [4.1 Windows](4.1-ui-rules.md#windows)
- **Worktree per Task**: [5.5 A worktree per Task](5.5-git-and-isolation.md#a-worktree-per-task); [5.5 Guards](5.5-git-and-isolation.md#guards)
- **Words and copy (UI)**: [4.1 Words](4.1-ui-rules.md#words); [4 Copy](4-ux-direction.md#copy)
- **Known risks**: [8 Subscription terms](8-risks.md#subscription-terms); [8 No sandbox](8-risks.md#no-sandbox)

## Contents

- [1. The user's day](1-the-users-day.md): morning, during the day, while work runs.

### 2. Domain model

- [2.1 Work](2.1-work.md): index of the pages below.
  - [2.1.1 Projects](2.1.1-projects.md): Project, its settings, a Kind's default Pipeline, test targets, Project limit, Icon and Logo, Project commands, the re-run command, GitHub issues.
  - [2.1.2 Ideas and Attachments](2.1.2-ideas-and-attachments.md): Idea, Attachment, text files and PDFs, pasted images.
  - [2.1.3 Tasks](2.1.3-tasks.md): Task, its Kind and bug details, its states, Ready, Description, Commit message, dependencies, Drop reason, GitHub issue, priority, archive, moving.
  - [2.1.4 Initiatives](2.1.4-initiatives.md): Initiative, its states, shaping, Plan the Initiative, its Pipeline, Back to Shaping, Publishing Tasks, Pause, its test instances.
  - [2.1.5 Planning and Start](2.1.5-planning-and-start.md): Plan and Definition of Done, Planning, Auto mode, the queue for Start, overlaps, Usage estimates.
  - [2.1.6 Board and search](2.1.6-board-and-search.md): the board, the Kind filter, search, Saved views, Group by Initiative, the Pull requests and CI tabs.
- [2.2 People](2.2-people.md): Role, Agent, Role card, authority, escalation, presets, duties, the Office Manager, limits.
- [2.3 Pipelines](2.3-pipelines.md): index of the pages below.
  - [2.3.1 Stages](2.3.1-stages.md): Stage kinds, what a Stage declares, how it ends, skipping, Review & fix.
  - [2.3.2 Flows](2.3.2-flows.md): routes, conditions, the stage runs file, on failure, who is asked, validation.
  - [2.3.3 Gates and checks](2.3.3-gates-and-checks.md): Gates, Send back, Gate notes, Reported met and Out of reach.
  - [2.3.4 Publish](2.3.4-publish.md): Publish, the commit message, before and after publishing, pull requests, conflicts.
  - [2.3.5 Library and Project Pipelines](2.3.5-library.md): built-in Pipelines, the library, Stage templates, Project Pipelines.
- [2.4 Conversations](2.4-conversations.md): index of the pages below.
  - [2.4.1 Threads](2.4.1-threads.md): homes, Threads, what a Thread reads, Allow changes.
  - [2.4.2 Decisions](2.4.2-decisions.md): the form, Submit and Ask me again, the Bug Task Decision, where it shows.
  - [2.4.3 Consultations](2.4.3-consultations.md): Consultation, calls from chats.
  - [2.4.4 Messages](2.4.4-messages.md): barge-in, Office actions, Mentions, images, Open page, commands.
  - [2.4.5 Stopping and restarts](2.4.5-stopping-and-restarts.md): Stop, Pause, shutdown, restarts, refused turns.
  - [2.4.6 Reading records](2.4.6-reading-records.md): reading the Stage history and the Threads.
- [2.5 Context policy](2.5-context-policy.md): resume, fresh or hand off; the Brief, the Handover note, overrides, a Stage's context limits.
- [2.6 Skills](2.6-skills.md): the library, adding skills, Project skills, what a session gets.
- [2.7 Notifications](2.7-notifications.md): kinds, channels, content, routing defaults.
- [2.8 Fire alarm](2.8-fire-alarm.md): the alarm and the all clear.
- [2.9 Sub-agents and processes](2.9-sub-agents-and-processes.md): index of the pages below.
  - [2.9.1 The model](2.9.1-the-model.md): Sub-agents and Processes, what is kept and for how long.
  - [2.9.2 Session events](2.9.2-session-events.md): what each engine reports.
  - [2.9.3 Streaming and the UI](2.9.3-streaming-and-ui.md): live streaming and the read-only view.
- [2.10 Users and signing in](2.10-users-and-signing-in.md): users, the ways to sign in, signed-in devices, lockout, recovery, signing in to a test instance, who did what.
- [2.11 Stats](2.11-stats.md): index of the pages below.
  - [2.11.1 The Stats page](2.11.1-the-stats-page.md): basic and full stats, the states between.
  - [2.11.2 Tokens and cost](2.11.2-tokens-and-cost.md): what is counted, estimated cost, metric attributes.
  - [2.11.3 System health](2.11.3-system-health.md): health readings, slow routes and queries.
- [2.12 Test instances](2.12-test-instances.md): test targets and their kinds, what runs before the entry point and what The Office sets, the Proposal that writes them, test instances, their states, the proxy, Build to install files, safety, limits.
- [2.13 Connected devices](2.13-connected-devices.md): a device connected to a Task's run environment over USB through the browser or over Android wireless debugging, one to one Task, the relay and the Office device helper, states and lifecycle, what the image needs, the adb key, what Agents see, who connects.

### 4. UX

- [4. UX direction](4-ux-direction.md): the shell, themes, brand, copy, and the list of screens.
- [4.1 UI rules](4.1-ui-rules.md): how every screen is built: `packages/ui` components, windows, list and details, long text, words.

### Screens

One page per screen, as built. Where a [design](../design/README.md) differs, the screen page wins.

- [Shell](screens/shell.md): rail, top bar, status strip, chat drawer, Needs you panel.
- [Now](screens/now.md)
- [Work board](screens/work-board.md): the Work page and its Tasks tab.
- [Ideas](screens/ideas.md), [Initiatives tab](screens/initiatives-tab.md), [Pull requests](screens/pull-requests.md), [CI runs](screens/ci-runs.md), [Archived](screens/archived.md): the other Work tabs.
- [Task page](screens/task-page.md)
- [Initiative page](screens/initiative-page.md)
- [Thread](screens/thread.md) and [Decision card](screens/decision-card.md): shared by the chat drawer, the Task page and the Initiative page.
- [Projects](screens/projects.md) and [Project page](screens/project-page.md)
- [Pipeline flow editor](screens/pipeline-flow-editor.md): shared by Settings › Pipelines, Project Pipelines and a Task's Stages.
- [People](screens/people.md)
- [Settings](screens/settings.md)
- [Stats](screens/stats.md)
- [Live view](screens/live-view.md)
- [Account](screens/account.md)
- [Sign in](screens/sign-in.md): the sign-in pages and First-run setup.

### 5. Architecture and stack

- [5.1 Shape](5.1-shape.md): one Node service, its addresses and the public address, the test instance proxy, Windows and Linux.
  - [5.1.1 Releases and installs](5.1.1-releases-and-installs.md): released versions, the direct and Compose installs.
  - [5.1.2 Updates and restarts](5.1.2-updates-and-restarts.md): updating and restarting The Office.
- [5.2 Stack](5.2-stack.md): TypeScript on Node 22, backend, web, data, infrastructure, telemetry.
- [5.3 Modules](5.3-modules.md): the bounded contexts and how they talk.
- [5.4 The engine](5.4-the-engine.md): index of the pages below.
  - [5.4.1 Engine port and kinds](5.4.1-engine-kinds.md): the `AgentEngine` port, the engine kinds, native features, cache breakers, pinned versions.
  - [5.4.2 The OpenAI-compatible API engine](5.4.2-openai-compatible-api-engine.md)
  - [5.4.3 The Codex engine](5.4.3-codex-engine.md)
  - [5.4.4 The Copilot CLI engine](5.4.4-copilot-cli-engine.md)
  - [5.4.5 Engines and the engine cascade](5.4.5-engines-and-cascade.md)
  - [5.4.6 Stand-in Engines and usage windows](5.4.6-stand-in-engines-and-usage-windows.md)
  - [5.4.7 The Gemini CLI engine](5.4.7-gemini-cli-engine.md)
- [5.5 Git and isolation](5.5-git-and-isolation.md): a worktree per Task, guards, environment as data, the Office identity, run environments, test instances' checkouts.
- [5.6 Skills per session](5.6-skills-per-session.md): what a session lists at start.

### Safety and risks

- [6. Permissions and safety](6-permissions-and-safety.md): threat model, only hashes stored, the two layers, Hard switches, profiles, secrets, test instances, build rules.
- [8. Risks](8-risks.md)

## Defaults

Where each default lives, by page:

- 2.1.1 Projects
  - [No re-run command](2.1.1-projects.md#no-re-run-command)
  - [GitHub issues switches](2.1.1-projects.md#github-issues-switches)
  - [Onboarding a Project](2.1.1-projects.md#onboarding-a-project)
- 2.1.2 Ideas and Attachments
  - [Plan as a Task with the Planner](2.1.2-ideas-and-attachments.md#plan-as-a-task-with-the-planner)
- 2.1.3 Tasks
  - [New Tasks are Features](2.1.3-tasks.md#new-tasks-are-features)
  - [Tasks of an Initiative still being shaped](2.1.3-tasks.md#tasks-of-an-initiative-still-being-shaped)
  - [Archive](2.1.3-tasks.md#archive)
  - [Moving a Task](2.1.3-tasks.md#moving-a-task)
  - [A Dropped blocker](2.1.3-tasks.md#a-dropped-blocker)
  - [Tags](2.1.3-tasks.md#tags)
  - [Conflict resolution Tasks](2.1.3-tasks.md#conflict-resolution-tasks)
- 2.1.4 Initiatives
  - [Shaping without a CTO](2.1.4-initiatives.md#shaping-without-a-cto)
  - [Creating an Initiative](2.1.4-initiatives.md#creating-an-initiative)
  - [The CTO's changes to an Initiative](2.1.4-initiatives.md#the-ctos-changes-to-an-initiative)
  - [Decisions in the shaping Thread](2.1.4-initiatives.md#decisions-in-the-shaping-thread)
  - [An Initiative starts in its Idea's Project](2.1.4-initiatives.md#an-initiative-starts-in-its-ideas-project)
  - [The user writes the outcome](2.1.4-initiatives.md#the-user-writes-the-outcome)
  - [An Initiative is done](2.1.4-initiatives.md#an-initiative-is-done)
  - [An Initiative's Pipeline](2.1.4-initiatives.md#an-initiatives-pipeline)
  - [Back to Shaping](2.1.4-initiatives.md#back-to-shaping)
  - [Publishing Tasks](2.1.4-initiatives.md#publishing-tasks)
  - [Start Ready Tasks](2.1.4-initiatives.md#start-ready-tasks)
  - [Pause the Initiative](2.1.4-initiatives.md#pause-the-initiative)
  - [The Initiatives tab is a board](2.1.4-initiatives.md#the-initiatives-tab-is-a-board)
- 2.1.5 Planning and Start
  - [Waiting on you while planning](2.1.5-planning-and-start.md#waiting-on-you-while-planning)
  - [The Planner joins on the first message](2.1.5-planning-and-start.md#the-planner-joins-on-the-first-message)
  - [A queue for Start](2.1.5-planning-and-start.md#a-queue-for-start)
  - [Start anyway past the usage caps](2.1.5-planning-and-start.md#start-anyway-past-the-usage-caps)
  - [Overlaps at Start](2.1.5-planning-and-start.md#overlaps-at-start)
  - [A pause by the usage window](2.1.5-planning-and-start.md#a-pause-by-the-usage-window)
  - [Usage estimates](2.1.5-planning-and-start.md#usage-estimates)
- 2.1.6 Board and search
  - [Search](2.1.6-board-and-search.md#search)
  - [Saved views and the Project filter](2.1.6-board-and-search.md#saved-views-and-the-project-filter)
  - [Group by Initiative](2.1.6-board-and-search.md#group-by-initiative)
  - [The Pull requests tab](2.1.6-board-and-search.md#the-pull-requests-tab)
  - [The CI tab](2.1.6-board-and-search.md#the-ci-tab)
- 2.2 People
  - [A Task waiting on the user or paused still counts](2.2-people.md#a-task-waiting-on-the-user-or-paused-still-counts)
  - [The Office-wide limit on running Tasks](2.2-people.md#the-office-wide-limit-on-running-tasks)
  - [Preset Task limits](2.2-people.md#preset-task-limits)
  - [Duties](2.2-people.md#duties)
  - [Who holds a duty](2.2-people.md#who-holds-a-duty)
  - [Duties on screen](2.2-people.md#duties-on-screen)
  - [Setting up an Office with nobody hired](2.2-people.md#setting-up-an-office-with-nobody-hired)
  - [A person's headline state on the Live view](2.2-people.md#a-persons-headline-state-on-the-live-view)
- 2.3.1 Stages
  - [A Stage names a Role or a duty](2.3.1-stages.md#a-stage-names-a-role-or-a-duty)
  - [An Agent Stage's Project commands](2.3.1-stages.md#an-agent-stages-project-commands)
  - [An Agent Stage's message names the Stages after it](2.3.1-stages.md#an-agent-stages-message-names-the-stages-after-it)
  - [Script Stages in the run environment](2.3.1-stages.md#script-stages-in-the-run-environment)
  - [The Task's branch keeps up with the base](2.3.1-stages.md#the-tasks-branch-keeps-up-with-the-base)
  - [A branch moved outside The Office](2.3.1-stages.md#a-branch-moved-outside-the-office)
- 2.3.2 Flows
  - [The holder of Asked first on failures](2.3.2-flows.md#the-holder-of-asked-first-on-failures)
  - [A refused turn is no failure](2.3.2-flows.md#a-refused-turn-is-no-failure)
- 2.3.3 Gates and checks
  - [Statements Out of reach](2.3.3-gates-and-checks.md#statements-out-of-reach)
  - [Reports count across Stages, and the check runs before Publish](2.3.3-gates-and-checks.md#reports-count-across-stages-and-the-check-runs-before-publish)
  - [A Gate just before Publish is the check](2.3.3-gates-and-checks.md#a-gate-just-before-publish-is-the-check)
- 2.3.4 Publish
  - [The Office's own credentials for publishing](2.3.4-publish.md#the-offices-own-credentials-for-publishing)
  - [Publish is a publishing mode, not a Project command](2.3.4-publish.md#publish-is-a-publishing-mode-not-a-project-command)
  - [The Task's commit message](2.3.4-publish.md#the-tasks-commit-message)
  - [Publish's before and after lines](2.3.4-publish.md#publishs-before-and-after-lines)
  - [Merge mode when the base moved](2.3.4-publish.md#merge-mode-when-the-base-moved)
  - [The Changes tab after Publish shows what Publish shipped](2.3.4-publish.md#the-changes-tab-after-publish-shows-what-publish-shipped)
  - [The proof-of-concept publish target](2.3.4-publish.md#the-proof-of-concept-publish-target)
  - [Conflicts at Publish](2.3.4-publish.md#conflicts-at-publish)
  - [Publishing into an Initiative's branch](2.3.4-publish.md#publishing-into-an-initiatives-branch)
  - [A Publishing Task's Publish](2.3.4-publish.md#a-publishing-tasks-publish)
  - [The Office records the pull requests it opens, and refreshes them every minute](2.3.4-publish.md#the-office-records-the-pull-requests-it-opens-and-refreshes-them-every-minute)
- 2.3.5 Library and Project Pipelines
  - [Project commands by Proposal and by hand](2.3.5-library.md#project-commands-by-proposal-and-by-hand)
  - [A Pipeline needs the commands it runs](2.3.5-library.md#a-pipeline-needs-the-commands-it-runs)
  - [Project Pipelines](2.3.5-library.md#project-pipelines)
  - [A Broken Project Pipeline](2.3.5-library.md#a-broken-project-pipeline)
- 2.4.1 Threads
  - [Thread titles](2.4.1-threads.md#thread-titles)
- 2.4.2 Decisions
  - [Agents wait on the user without blocking a tool call](2.4.2-decisions.md#agents-wait-on-the-user-without-blocking-a-tool-call)
  - [A Decision belongs to the asking Agent's Thread](2.4.2-decisions.md#a-decision-belongs-to-the-asking-agents-thread)
  - [The Decision on Stages waiting for a Stand-in Engine](2.4.2-decisions.md#the-decision-on-stages-waiting-for-a-stand-in-engine)
- 2.4.5 Stopping and restarts
  - [A turn refused for the usage window](2.4.5-stopping-and-restarts.md#a-turn-refused-for-the-usage-window)
  - [After a restart](2.4.5-stopping-and-restarts.md#after-a-restart)
- 2.5 Context policy
  - [A Stage's session has a Soft limit and a Hard limit](2.5-context-policy.md#a-stages-session-has-a-soft-limit-and-a-hard-limit)
  - [A person's session default decides only the cold case](2.5-context-policy.md#a-persons-session-default-decides-only-the-cold-case)
  - [The Context policy's size threshold counts what the conversation added](2.5-context-policy.md#the-context-policys-size-threshold-counts-what-the-conversation-added)
  - [A chat Thread's Brief](2.5-context-policy.md#a-chat-threads-brief)
  - [A person's Thread on a Task's Brief](2.5-context-policy.md#a-persons-thread-on-a-tasks-brief)
  - [An Initiative's planning Thread's Brief](2.5-context-policy.md#an-initiatives-planning-threads-brief)
- 2.6 Skills
  - [Skills the user writes or uploads](2.6-skills.md#skills-the-user-writes-or-uploads)
  - [A skill's new version waits for review too](2.6-skills.md#a-skills-new-version-waits-for-review-too)
  - [Installing from a source](2.6-skills.md#installing-from-a-source)
  - [The pinned version](2.6-skills.md#the-pinned-version)
  - [Updates are flagged, then proposed](2.6-skills.md#updates-are-flagged-then-proposed)
  - [An applied update is its review](2.6-skills.md#an-applied-update-is-its-review)
  - [A skill drafted as a Proposal](2.6-skills.md#a-skill-drafted-as-a-proposal)
  - [A skill's description](2.6-skills.md#a-skills-description)
  - [Editing a skill](2.6-skills.md#editing-a-skill)
  - [A skill's frontmatter is read as the engine reads it](2.6-skills.md#a-skills-frontmatter-is-read-as-the-engine-reads-it)
  - [A skill's frontmatter is flagged, not refused](2.6-skills.md#a-skills-frontmatter-is-flagged-not-refused)
  - [A user-only skill](2.6-skills.md#a-user-only-skill)
  - [Project skills turn off one by one](2.6-skills.md#project-skills-turn-off-one-by-one)
  - [A skill use](2.6-skills.md#a-skill-use)
  - [The count](2.6-skills.md#the-count)
- 2.7 Notifications
  - [Office kinds](2.7-notifications.md#office-kinds)
  - [A failed Task](2.7-notifications.md#a-failed-task)
  - [Since you left begins after five idle minutes](2.7-notifications.md#since-you-left-begins-after-five-idle-minutes)
  - [Window nearly used at 90%](2.7-notifications.md#window-nearly-used-at-90)
  - [A usage window used up](2.7-notifications.md#a-usage-window-used-up)
  - [Stages waiting for a Stand-in Engine](2.7-notifications.md#stages-waiting-for-a-stand-in-engine)
  - [Opening what a Notification points to handles it](2.7-notifications.md#opening-what-a-notification-points-to-handles-it)
  - [Quiet hours hold the desktop](2.7-notifications.md#quiet-hours-hold-the-desktop)
  - [Batching Outcomes](2.7-notifications.md#batching-outcomes)
  - [The grid's rows](2.7-notifications.md#the-grids-rows)
  - [Initiatives being shaped on Now](2.7-notifications.md#initiatives-being-shaped-on-now)
  - [Today's figures](2.7-notifications.md#todays-figures)
  - [The tab counts Needs you and blinks for a new item](2.7-notifications.md#the-tab-counts-needs-you-and-blinks-for-a-new-item)
  - [A Decision in a chat isn't in Needs you](2.7-notifications.md#a-decision-in-a-chat-isnt-in-needs-you)
- 2.8 Fire alarm
  - [Acting during the alarm](2.8-fire-alarm.md#acting-during-the-alarm)
  - [The alarm's details](2.8-fire-alarm.md#the-alarms-details)
  - [Stopping and resuming during the alarm](2.8-fire-alarm.md#stopping-and-resuming-during-the-alarm)
  - [The alarm and an Initiative's Pause](2.8-fire-alarm.md#the-alarm-and-an-initiatives-pause)
  - [The alarm, an Initiative's Pause and the usage window](2.8-fire-alarm.md#the-alarm-an-initiatives-pause-and-the-usage-window)
- 2.9.1 The model
  - [How long they are kept](2.9.1-the-model.md#how-long-they-are-kept)
  - [Caps on what is kept](2.9.1-the-model.md#caps-on-what-is-kept)
  - [Masking a Process's output](2.9.1-the-model.md#masking-a-processs-output)
  - [Output batching](2.9.1-the-model.md#output-batching)
- 2.9.2 Session events
  - [What the adapters report](2.9.2-session-events.md#what-the-adapters-report)
- 2.9.3 Streaming and the UI
  - [What the web events carry](2.9.3-streaming-and-ui.md#what-the-web-events-carry)
- 2.10 Users and signing in
  - [Password rules](2.10-users-and-signing-in.md#password-rules)
  - [The one-time password](2.10-users-and-signing-in.md#the-one-time-password)
  - [Slow-down and lockout](2.10-users-and-signing-in.md#slow-down-and-lockout)
  - [How long a device stays signed in](2.10-users-and-signing-in.md#how-long-a-device-stays-signed-in)
  - [Recovery codes](2.10-users-and-signing-in.md#recovery-codes)
  - [The authenticator](2.10-users-and-signing-in.md#the-authenticator)
  - [Removing users](2.10-users-and-signing-in.md#removing-users)
  - [The setup token](2.10-users-and-signing-in.md#the-setup-token)
  - [Skipping the basics](2.10-users-and-signing-in.md#skipping-the-basics)
  - [Records from before users](2.10-users-and-signing-in.md#records-from-before-users)
  - [Since you left per user](2.10-users-and-signing-in.md#since-you-left-per-user)
- 2.11.1 The Stats page
  - [Tokens per day and the Usage windows are Office-wide](2.11.1-the-stats-page.md#tokens-per-day-and-the-usage-windows-are-office-wide)
  - ["This week"](2.11.1-the-stats-page.md#this-week)
  - [System health is Office-wide](2.11.1-the-stats-page.md#system-health-is-office-wide)
- 2.11.2 Tokens and cost
  - [Estimated cost](2.11.2-tokens-and-cost.md#estimated-cost)
  - [The Task attribute](2.11.2-tokens-and-cost.md#the-task-attribute)
  - [Metric attributes carry names](2.11.2-tokens-and-cost.md#metric-attributes-carry-names)
  - [The default range of Tokens and cost](2.11.2-tokens-and-cost.md#the-default-range-of-tokens-and-cost)
- 2.11.3 System health
  - [Routes are named by their template, statements by their shape](2.11.3-system-health.md#routes-are-named-by-their-template-statements-by-their-shape)
  - [1 h is the default range](2.11.3-system-health.md#1-h-is-the-default-range)
- 2.12 Test instances
  - [Port variable](2.12-test-instances.md#port-variable)
  - [Test instances at once](2.12-test-instances.md#test-instances-at-once)
  - [Idle time](2.12-test-instances.md#idle-time)
  - [Proxy ports](2.12-test-instances.md#proxy-ports)
  - [Build time](2.12-test-instances.md#build-time)
  - [Kept Build to install files](2.12-test-instances.md#kept-build-to-install-files)
  - [Implementation notes](2.12-test-instances.md#implementation-notes)
- 2.13 Connected devices
  - [Serial path](2.13-connected-devices.md#serial-path)
  - [The helper's wait](2.13-connected-devices.md#the-helpers-wait)
  - [A dropped relay socket](2.13-connected-devices.md#a-dropped-relay-socket)
  - [Browsers supported](2.13-connected-devices.md#browsers-supported)
- 4 UX direction
  - [Palette](4-ux-direction.md#palette)
  - [Density](4-ux-direction.md#density)
  - [Rail](4-ux-direction.md#rail)
- 4.1 UI rules
  - [Window sizes](4.1-ui-rules.md#window-sizes)
  - [Chat drawer width](4.1-ui-rules.md#chat-drawer-width)
  - [Needs you panel width](4.1-ui-rules.md#needs-you-panel-width)
  - [Reading width](4.1-ui-rules.md#reading-width)
  - [Picture thumbnails](4.1-ui-rules.md#picture-thumbnails)
- 5.1 Shape
  - [Windows and Linux](5.1-shape.md#windows-and-linux)
  - [Only The Office's own pages reach the service](5.1-shape.md#only-the-offices-own-pages-reach-the-service)
  - [The public address](5.1-shape.md#the-public-address)
  - Proxy ports: [2.12](2.12-test-instances.md#proxy-ports)
- 5.1.1 Releases and installs
  - [Released versions](5.1.1-releases-and-installs.md#released-versions)
  - [Installing on Debian/Ubuntu](5.1.1-releases-and-installs.md#installing-on-debianubuntu)
  - [Uninstalling](5.1.1-releases-and-installs.md#uninstalling)
  - [Installing with Docker Compose](5.1.1-releases-and-installs.md#installing-with-docker-compose)
- 5.1.2 Updates and restarts
  - [Updating The Office](5.1.2-updates-and-restarts.md#updating-the-office)
  - [Restarting The Office](5.1.2-updates-and-restarts.md#restarting-the-office)
- 5.3 Modules
  - [Skills is its own module](5.3-modules.md#skills-is-its-own-module)
  - [MCP servers is its own module](5.3-modules.md#mcp-servers-is-its-own-module)
  - [Prompt templates is its own module](5.3-modules.md#prompt-templates-is-its-own-module)
  - [GitHub is its own module](5.3-modules.md#github-is-its-own-module)
  - [Now lives in the Notifications module](5.3-modules.md#now-lives-in-the-notifications-module)
  - [The Live view's read model lives in Conversations](5.3-modules.md#the-live-views-read-model-lives-in-conversations)
  - [Users is its own module](5.3-modules.md#users-is-its-own-module)
  - [Telemetry owns Stats](5.3-modules.md#telemetry-owns-stats)
  - [The System health recorder sits in the platform layer](5.3-modules.md#the-system-health-recorder-sits-in-the-platform-layer)
  - [Test instances uses Run environments through their public interface](5.3-modules.md#test-instances-uses-run-environments-through-their-public-interface)
  - [Devices uses Run environments through their public interface](5.3-modules.md#devices-uses-run-environments-through-their-public-interface)
  - [Office updates is reached through BusyWork](5.3-modules.md#office-updates-is-reached-through-busywork)
- 5.4.1 Engine port and kinds
  - [Office actions](5.4.1-engine-kinds.md#office-actions)
  - [The `-p` fallback matches the Agent SDK adapter](5.4.1-engine-kinds.md#the--p-fallback-matches-the-agent-sdk-adapter)
  - [MCP servers for Agents](5.4.1-engine-kinds.md#mcp-servers-for-agents)
  - [Language servers for Agents](5.4.1-engine-kinds.md#language-servers-for-agents)
  - [A Stage's Sub-agents run in the foreground](5.4.1-engine-kinds.md#a-stages-sub-agents-run-in-the-foreground)
- 5.4.2 The OpenAI-compatible API engine
  - [The OpenAI-compatible API engine is The Office's own agent loop](5.4.2-openai-compatible-api-engine.md#the-openai-compatible-api-engine-is-the-offices-own-agent-loop)
- 5.4.3 The Codex engine
  - [The Codex engine](5.4.3-codex-engine.md#the-codex-engine)
  - [Codex sign-in](5.4.3-codex-engine.md#codex-sign-in)
  - [Codex: the Office rules through approval requests](5.4.3-codex-engine.md#codex-the-office-rules-through-approval-requests)
  - [Codex: sandbox kept to the worktree](5.4.3-codex-engine.md#codex-sandbox-kept-to-the-worktree)
  - [Codex: Office tools over MCP](5.4.3-codex-engine.md#codex-office-tools-over-mcp)
  - [Codex: Stage answers held to the schema](5.4.3-codex-engine.md#codex-stage-answers-held-to-the-schema)
  - [Codex: usage windows](5.4.3-codex-engine.md#codex-usage-windows)
  - [Codex: cost](5.4.3-codex-engine.md#codex-cost)
  - [Codex: capabilities as the engine check showed them](5.4.3-codex-engine.md#codex-capabilities-as-the-engine-check-showed-them)
  - [Codex's own features kept out](5.4.3-codex-engine.md#codexs-own-features-kept-out)
- 5.4.4 The Copilot CLI engine
  - [The Copilot CLI engine](5.4.4-copilot-cli-engine.md#the-copilot-cli-engine)
  - [Copilot CLI: the Office rules through the pre-tool-use hook](5.4.4-copilot-cli-engine.md#copilot-cli-the-office-rules-through-the-pre-tool-use-hook)
  - [Copilot CLI: Office tools and MCP servers](5.4.4-copilot-cli-engine.md#copilot-cli-office-tools-and-mcp-servers)
  - [Copilot CLI: kept out](5.4.4-copilot-cli-engine.md#copilot-cli-kept-out)
  - [Copilot CLI: Sub-agents](5.4.4-copilot-cli-engine.md#copilot-cli-sub-agents)
  - [Copilot CLI: usage](5.4.4-copilot-cli-engine.md#copilot-cli-usage)
  - [Copilot CLI: capabilities as the engine check showed them](5.4.4-copilot-cli-engine.md#copilot-cli-capabilities-as-the-engine-check-showed-them)
- 5.4.5 Engines and the engine cascade
  - [Engines are a list](5.4.5-engines-and-cascade.md#engines-are-a-list)
  - [A Claude Code engine](5.4.5-engines-and-cascade.md#a-claude-code-engine)
  - [A Copilot CLI engine](5.4.5-engines-and-cascade.md#a-copilot-cli-engine)
  - [A Gemini CLI engine](5.4.5-engines-and-cascade.md#a-gemini-cli-engine)
  - [An OpenAI-compatible API engine](5.4.5-engines-and-cascade.md#an-openai-compatible-api-engine)
  - [The engine cascade](5.4.5-engines-and-cascade.md#the-engine-cascade)
  - [Removing an engine](5.4.5-engines-and-cascade.md#removing-an-engine)
- 5.4.6 Stand-in Engines and usage windows
  - [Stand-in Engines](5.4.6-stand-in-engines-and-usage-windows.md#stand-in-engines)
  - [Picking the engine to run on](5.4.6-stand-in-engines-and-usage-windows.md#picking-the-engine-to-run-on)
  - [Stand-ins at Start](5.4.6-stand-in-engines-and-usage-windows.md#stand-ins-at-start)
  - [A running Stage switches](5.4.6-stand-in-engines-and-usage-windows.md#a-running-stage-switches)
  - [A person's Thread switches](5.4.6-stand-in-engines-and-usage-windows.md#a-persons-thread-switches)
  - [Carrying a session](5.4.6-stand-in-engines-and-usage-windows.md#carrying-a-session)
  - [A turn refused for a used-up usage window](5.4.6-stand-in-engines-and-usage-windows.md#a-turn-refused-for-a-used-up-usage-window)
  - [Checking the usage windows](5.4.6-stand-in-engines-and-usage-windows.md#checking-the-usage-windows)
- 5.4.7 The Gemini CLI engine
  - [The Gemini CLI engine](5.4.7-gemini-cli-engine.md#the-gemini-cli-engine)
  - [Gemini CLI: sign-in](5.4.7-gemini-cli-engine.md#gemini-cli-sign-in)
  - [Gemini CLI: the headless transport](5.4.7-gemini-cli-engine.md#gemini-cli-the-headless-transport)
  - [Gemini CLI: the repository's Gemini settings](5.4.7-gemini-cli-engine.md#gemini-cli-the-repositorys-gemini-settings)
  - [Gemini CLI: the Office rules through the BeforeTool hook](5.4.7-gemini-cli-engine.md#gemini-cli-the-office-rules-through-the-beforetool-hook)
  - [Gemini CLI: Office tools and MCP servers](5.4.7-gemini-cli-engine.md#gemini-cli-office-tools-and-mcp-servers)
  - [Gemini CLI: answers held to a schema](5.4.7-gemini-cli-engine.md#gemini-cli-answers-held-to-a-schema)
  - [Gemini CLI: skills and instructions](5.4.7-gemini-cli-engine.md#gemini-cli-skills-and-instructions)
  - [Gemini CLI: usage](5.4.7-gemini-cli-engine.md#gemini-cli-usage)
  - [Gemini CLI: capabilities as the engine check showed them](5.4.7-gemini-cli-engine.md#gemini-cli-capabilities-as-the-engine-check-showed-them)
- 5.5 Git and isolation
  - [Install inputs](5.5-git-and-isolation.md#install-inputs)
  - [The base branch's upstream](5.5-git-and-isolation.md#the-base-branchs-upstream)
  - [Clones](5.5-git-and-isolation.md#clones)
  - [The Office identity](5.5-git-and-isolation.md#the-office-identity)
  - [The CPU limit](5.5-git-and-isolation.md#the-cpu-limit)
  - [The other limits of run environments](5.5-git-and-isolation.md#the-other-limits-of-run-environments)
  - [A test instance's checkout](5.5-git-and-isolation.md#a-test-instances-checkout)
  - [The build cache volume](5.5-git-and-isolation.md#the-build-cache-volume)
  - [The repository's git data in a run environment](5.5-git-and-isolation.md#the-repositorys-git-data-in-a-run-environment)
  - [The file of earlier Stage runs in a run environment](5.5-git-and-isolation.md#the-file-of-earlier-stage-runs-in-a-run-environment)
  - [The Office device helper in a run environment](5.5-git-and-isolation.md#the-office-device-helper-in-a-run-environment)
  - [Run environments with a non-root Office](5.5-git-and-isolation.md#run-environments-with-a-non-root-office)
  - [Writing the run environment definition](5.5-git-and-isolation.md#writing-the-run-environment-definition)
- 6 Permissions and safety
  - [Hard switches by role](6-permissions-and-safety.md#hard-switches-by-role)
  - [Default profiles](6-permissions-and-safety.md#default-profiles)

A new default goes into the Defaults of the page it belongs to and gets a line here; a new concept gets a line in the [topic map](#topic-map) ([AGENTS.md](../../AGENTS.md), "Knowledge base").
