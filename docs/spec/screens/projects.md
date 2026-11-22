# Projects page and Add a Project

Covers: the Projects page (the Projects list beside the open Project, a list item per Project, Add a Project at the list's foot, the empty pane, Ask Devops), the Add a Project window (step 1 Where it is: a folder, a git URL, From GitHub; step 2 the Project's fields), the Mark picker, the clone's progress, the GitHub repository list.

## Where it is

- Route: `/projects`, the parent of every Project's page at `/projects/$projectId/…` ([project-page.md](project-page.md)).
- Open it from the Projects item in the rail ([shell.md](shell.md)).
- At `/projects` the page title is "Projects"; its crumb is the count of every Project: "1 Project" or "N Projects". The Project filter never changes the count.
- On a Project's page the title is the Project's, with "Projects" as its parent ([project-page.md](project-page.md#where-it-is)).
- A list item opens the Project's page in the pane beside the list.
- Add a Project is a window over the page; it has no route of its own.

## Layout

- Two panes, as Settings has: the Projects list on the left (about 260px wide), the open Project or the empty pane on the right.
- The list is a navigation landmark labelled "Projects".
- The items of the Projects the Project filter shows, in the service's order ([shell.md](shell.md)).
- The list's foot, under the items:
  - the note of Projects hidden by the Project filter;
  - **Add a Project** and Ask Devops ([Add a Project](#add-a-project)).
- A read error of the Projects shows above both panes as a danger alert with the service's words.

## Project item

- The whole item is a link to the Project's page, about 52px tall.
- It shows the Project's Logo, else its Icon, else its mark ([project-page.md](project-page.md#appearance)), then its name.
- At its end: the onboarding badge, **Onboarding** (info) or **Onboarded** (success), only for a Project with an Onboard Task.
- The open Project's item is marked active on every section and sub-address of its page.
- A Project the Project filter hides still opens beside the list, from a link or an address, with no item marked.

## Add a Project

- The list's foot:
  - **Add a Project** (folder-plus icon): opens the Add a Project window.
  - **Ask <name> to onboard one** (the Ask Devops button): opens a new Thread in the holder's chat of Onboards and repairs Projects (the Devops duty) with the draft "Can you onboard a new Project? The repository is " waiting. While nobody holds the duty, a note says so instead of the button.
- The empty pane, at the bare `/projects` beside the list:
  - Title "Open a Project from the list, or add one", a folder icon.
  - Text while someone holds the Devops duty and can chat: "<name> prepares it until it builds and tests in a fresh worktree, and asks before installing anything. Or give its folder or git URL, base branch and commands yourself."
  - Text otherwise: "Give its folder or git URL, base branch and commands. Script Stages run the commands in each Task's worktree."
  - Actions: **Add it yourself** (opens the Add a Project window) and the same Ask Devops button.

## Add a Project window

- A medium window titled **Add a Project** that keeps one height between steps.
- The bar shows "Step 1 of 2" or "Step 2 of 2" at its end, after the action button.
- Closing it with anything typed or chosen (a folder, a URL, a picked repository, or a finished source) asks before discarding.
- Its columns lay out by the window's own width: two columns, one at a window width of 620px and under.
- **Add the Project** saves the Project, shows the toast "<name> added.", closes the window and opens the new Project's page.
- The service checks the path and the base branch before anything is saved; its refusal shows in step 2.

## Step 1: Where it is

- The field **Where it is** holds a segmented control, each option with a hint under the field:
  - **A folder**: "A git repository already on this workstation."
  - **A git URL**: "From any git host. The Office clones it into its data folder."
  - **From GitHub**: "The repositories The Office's GitHub App is installed on. Pick one, then Clone it."
- Choosing another option forgets any clone, the picked repository and what the source filled in.
- What was typed in each option stays while the window is open, so **Change** finds it again.
- The bar's action depends on the option: **Continue** (folder), **Clone** (git URL and From GitHub).

### A folder

- Field **Repository folder**, hint "The repository's top-level folder, as a full path.", placeholder `/home/you/Projects/repository`, monospace, focused.
- **Continue** with it blank shows "Write the repository's folder, as a full path." and goes no further.
- Continue goes to step 2 with the folder as the source.

### A git URL

- Field **Repository URL**, hint "https, ssh:// or user@host:path. The Office clones it into its data folder.", placeholder `https://github.com/owner/repository.git`, monospace, focused.
- **Clone** with it blank shows "Write the repository's git URL."
- While a clone runs, the field is disabled, the Clone button shows loading, and a progress bar shows the clone's phase (or "Starting the clone") and its percent.
- A failed clone shows the danger alert **The clone failed** with git's problem; Clone again tries again.
- A refusal to start it (every reason, nothing cloned) shows as **The repository can't be cloned**.
- The clone's progress is read live from the `repository-clone.changed` event.
- A finished clone goes on to step 2.

### From GitHub

- The list is read as the window opens (while signed in with GitHub), so it is usually there by the time From GitHub is chosen.
- Search box (label "Search your repositories"): placeholder "Search by name, owner or description"; it matches name, owner and description, and marks the match; disabled while a clone runs.
- A card **Your repositories** with a count ("N", or "M of N" while searching).
- Rows, **Recent first**: sorted by last push, most recent on top; a repository never pushed sorts last.
- Each row: a book icon, the repository name, then "<owner> · <default branch> · <pushed words>", then its description; **Private** badge on a private repository.
- Clicking a row picks it (`aria-pressed`); the bar's **Clone** stays disabled until one is picked, then clones it by its Repository URL.
- While cloning, the row shows the progress bar and is not clickable; a failed clone shows "The clone failed: <problem>" in its row and the row can be picked again; Clone again tries again.
- A refusal to start the clone shows above the list.
- Repositories already added as a Project (matched by the Project's Repository URL in any form: https, ssh:// or user@host:path, with or without `.git`) are listed last under the label **Already added**, with "Already added, as the Project <name>." and an **Added** badge; they can't be picked.
- A Project added by folder has no Repository URL, so its repository is never marked Already added.
- Under the list, once it has rows: "Missing one? Install the App on more repositories" (a link to the App's install page, new tab).
- The step fills the body's height, so only the rows scroll.

## Step 2: the Project's fields

- First, one line showing the source: its kind (A folder, A git URL, From GitHub), its value (the path, the URL, or the repository's full name), **Private** for a private GitHub repository, and for a clone "cloned into <path>"; its **Change** button goes back to step 1, forgetting the clone and the name the source gave.
- A refusal of the add shows as **The Project can't be added yet** with the service's reasons.
- The form is filled once from each source: its path and Repository URL, the name (the folder's or the repository's, until the user writes one), and for a clone its default branch as the base branch. The user's edits stay.
- Fields, in order:
  - **Name**, focused.
  - **Mark**: the Mark picker ([project-page.md](project-page.md#appearance)); its label follows the name until the user writes one of their own.
  - **Base branch**, hint "Tasks branch from it and publish to it.": a text field (monospace) for a folder, a select of the clone's branches for a clone. Default `main`.
  - **Default Pipeline**, hint the chosen Pipeline's Stages line: a select of the office-wide Pipelines. Default `full`.
  - **Commands**, hint "Optional. Leave any you don't know yet: set them later on the Project's page, or ask whoever onboards Projects.": inputs **Install** (placeholder `npm ci`), **Build** (`npm run build`), **Lint** (`npm run lint`), **Test** (`npm test`), all monospace and optional.
  - **Install inputs**, hint "Files whose change makes a worktree install again, separated by commas. With none, a worktree installs once.", placeholder `package-lock.json`.
  - **Publishing**: radios, "Push and open a pull request" (default) or "Merge into <base branch>" (or "the base branch" while it is blank).
  - **Run this Project's checks in a run environment?**, hint "In the containers its .devcontainer/ defines. Until you decide, they run on this computer.": radios **Yes**, **No**, **Decide later** (picked first); the answer is sent with Add the Project.
- A new Project starts with the commands Build, Lint and Test (keys `build`, `lint`, `test`), install blank and no install inputs.

## States

- Projects page loading: the list shows its foot only; a read error shows the alert.
- No Project: the list's foot alone, beside the empty pane.
- Every Project hidden by the Project filter: the list's foot with the hidden note.
- Narrow page, at a page width of 1224px and under:
  - `/projects` shows the list alone.
  - A Project's page shows alone, with a **‹ All Projects** link above it back to the list.
- At 664px and under the page padding shrinks to 14px.
- The Add a Project button shows loading while the add runs.
- From GitHub:
  - Loading: rows of loaders labelled "Loading your repositories…".
  - Failure of the list or of the Projects: **GitHub's repositories can't be listed** or **Your Projects can't be read** with the service's words and **Try again**.
  - Sign in with GitHub can't be read: **Sign in with GitHub can't be read**.
  - Signed out: one block **Sign in with GitHub first**, "Sign in with GitHub in Settings › Office identity, then the repositories the App is installed on show here.", with **Open Settings › Office identity** and **Use a git URL instead** (which switches to A git URL).
  - The App not registered: the block **Register the GitHub App first**, "The Office needs its own GitHub App before it can list your repositories. Register it and sign in in Settings › Office identity, then the repositories the App is installed on show here." with the same two actions.
  - No repository: "The App is installed on no repository you can reach yet." with "Install the App on GitHub" (when the install link is known).
  - Search finds none: "No repository matches “<search>”." and "The search looks at every repository's name, owner and description."

## Domain facts

- A Project, its settings, the Project limit: [2.1.1](../2.1.1-projects.md#project).
- Project commands and Install inputs: [2.1.1](../2.1.1-projects.md#project-commands).
- Onboarding a Project: [2.1.1](../2.1.1-projects.md#onboarding-a-project).
- Publishing modes: [2.3.4](../2.3.4-publish.md#publish).
- Run environment (On, Off, Not decided yet) and Script Stages in it: [2.3.1](../2.3.1-stages.md#script-stages-in-the-run-environment).
- Repository URL (a Project's repository cloned into the Office data directory): [2.1.1](../2.1.1-projects.md#onboarding-a-project).
- The Office identity (Sign in with GitHub, ssh key): [5.5](../5.5-git-and-isolation.md).
