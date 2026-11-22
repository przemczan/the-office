# Projects page and Add a Project

Covers: the Projects page (a card per Project, the Add a Project card, Ask Devops), the Add a Project window (step 1 Where it is: a folder, a git URL, From GitHub; step 2 the Project's fields), the Mark picker, the clone's progress, the GitHub repository list.

## Where it is

- Route: `/projects`.
- Open it from the Projects item in the rail ([shell.md](shell.md)).
- The page title is "Projects"; its crumb is the count of every Project: "1 Project" or "N Projects". The Project filter never changes the count.
- A card opens the Project's page at `/projects/$projectId` ([project-page.md](project-page.md)).
- Add a Project is a window over the page; it has no route of its own.

## Layout

- A grid of cards: 3 columns, 2 at a page width of 1224px and under, 1 at 664px and under.
- The cards of the Projects the Project filter shows come first, in the service's order ([shell.md](shell.md)).
- The **Add a Project** card is the last in the grid.
- Under the grid, the note of Projects hidden by the Project filter.
- A read error of the Projects shows above the grid as a danger alert with the service's words.

## Project card

- The whole card is a link to the Project's page.
- Head: the Project's Logo, its name, and its folder path in monospace.
- At the head's end: the onboarding badge, **Onboarding** (info) or **Onboarded** (success), only for a Project with an Onboard Task, read from its latest one ([2.1.1](../2.1.1-projects.md#onboarding-a-project)).
- Foot line (route icon): "Default Pipeline <name> · <publishing words>".
  - The Pipeline is the Project's default Pipeline by name; while the Pipeline list loads, or if the Pipeline is gone, its id.
  - Publishing words: "Merge into <base branch>" or "Push and open a pull request".
- The Logo is the Project's Logo, else its Icon, else its mark ([project-page.md](project-page.md#appearance)).

## Add a Project card

- Title **Add a Project**, sub line "A repository on the workstation or a git URL", a folder-plus icon.
- Text while someone holds Onboards and repairs Projects (the Devops duty) and can chat: "<name> prepares it until it builds and tests in a fresh worktree, and asks before installing anything. Or give its folder or git URL, base branch and commands yourself."
- Text otherwise: "Give its folder or git URL, base branch and commands. Script Stages run the commands in each Task's worktree."
- Actions:
  - **Ask <name> to onboard one** (the Ask Devops button): opens a new Thread in the holder's chat with the draft "Can you onboard a new Project? The repository is " waiting. While nobody holds the duty, a note says so instead of the button.
  - The Project Proposal's card in that chat notes "Adds the Project and starts its Onboard Task at once."; Apply toasts "<name> added. Its Onboard Task started at once." and the card then reads "Added <name>. Its Onboard Task started at once: follow it on the Project page.", the last words a link to the Project page ([2.1.1](../2.1.1-projects.md#onboarding-a-project)).
  - **Add it yourself**: opens the Add a Project window.

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
  - **Run this Project's checks in a run environment?**, hint "In the containers its .devcontainer/ defines. Until you decide, they run on this computer.": radios **Yes**, **No**, **Decide later** (picked first); the answer is sent with Add the Project, Yes acting as Set up run environment ([2.1.3](../2.1.3-tasks.md#setting-up-the-run-environment)).
- A new Project starts with the commands Build, Lint and Test (keys `build`, `lint`, `test`), install blank and no install inputs.

## States

- Projects page loading: the grid shows the Add a Project card only; a read error shows the alert.
- No Project: the Add a Project card alone.
- Every Project hidden by the Project filter: the Add a Project card and the hidden note.
- Narrow page: 2 columns at 1224px and under, 1 at 664px and under (the page padding shrinks to 14px).
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
