# 4 UX direction

Covers: the UI spec, shell, Project mark, progressive disclosure, palettes, densities, brand, copy, screens.

## The UI spec

- The UI spec is this page and [4.1](4.1-ui-rules.md), with the [designs](../design/README.md) for the screens they name: [the chat drawer](../design/chat-drawer.html), [the Decision card](../design/decision-form.html), [Add a Project](../design/add-project.html), [the Pipeline flow editor](../design/pipeline-flow.html), [the Task page](../design/task-page-2.html), [the Initiative page](../design/initiative-page.html) and [its Pipelines block](../design/initiative-pipelines-block.html), [the Live view](../design/live-view.html).
- Every screen is built in React with the design system's components ([4.1](4.1-ui-rules.md#components)).
- Every window follows [4.1](4.1-ui-rules.md#windows).
- The code wins over a design where [the designs' README](../design/README.md) says it was built differently.

## Screens

- Seven surfaces, in the rail's order: Now, Work, People, Projects, Stats, Live view; **Settings** at the rail's foot.
- Outside the shell: the sign-in pages and First-run setup stand alone, without the shell.
- [shell.md](screens/shell.md): rail, top bar, status strip, Create, Chat button, Needs you panel, chat drawer.
- [now.md](screens/now.md): home: Needs you, Running, the queue for Start, the Initiatives being shaped, Since you left, today's tokens; nothing else.
- [thread.md](screens/thread.md): how a Thread reads (Turns, tool calls, the Office's lines).
- [decision-card.md](screens/decision-card.md): the Decision form, its sent state, an approval, the Gate's card.
- [sign-in.md](screens/sign-in.md): the sign-in pages and First-run setup.
- [account.md](screens/account.md): the user menu's Account page (name, email, password, authenticator, recovery codes, linked identities, passkeys, signed-in devices, Appearance).
- [work-board.md](screens/work-board.md): Work's Task board by state and its Task cards.
- [ideas.md](screens/ideas.md): Work's Ideas.
- [initiatives-tab.md](screens/initiatives-tab.md): Work's Initiatives with their graph.
- [pull-requests.md](screens/pull-requests.md): Work's Pull requests.
- [ci-runs.md](screens/ci-runs.md): Work's CI.
- [archived.md](screens/archived.md): Work's Archived.
- [task-page.md](screens/task-page.md): the Task page: Pipeline rail, record, Stage history, conversation, Browse files, Open in editor.
- [initiative-page.md](screens/initiative-page.md): the Initiative page and its Pipelines block.
- [projects.md](screens/projects.md): the Projects list and Add a Project.
- [project-page.md](screens/project-page.md): a Project's page: Files, commands, Environment, Pipelines, run environment, Engine, skills, MCP servers' values, Appearance (mark, Icon, Logo).
- [pipeline-flow-editor.md](screens/pipeline-flow-editor.md): the Pipeline flow editor, in Settings › Pipelines and a Project's Pipelines section.
- [people.md](screens/people.md): a grid of same-size cards; a page per person (Overview, Work, Conversations, Role card, Memory); hiring; duties on screen.
- [settings.md](screens/settings.md): Pipelines with their Stage templates, Duties, the skill library, MCP servers, Engines (Model prices, Stand-in Engines), the Office identity (Sign in with GitHub, the Office ssh key), Office limits, Office instructions ([2.2](2.2-people.md)), Prompt templates ([2.2](2.2-people.md)), Notifications, Updates, Users, Signing in (where Continue with Google is set up, [2.10](2.10-users-and-signing-in.md)), Telemetry.
- [stats.md](screens/stats.md): how The Office performs, above all tokens and Usage windows ([2.11](2.11-stats.md), [the design](../design/stats.html)).
- [live-view.md](screens/live-view.md): The Office as an isometric pixel-art office, each person a figure at a desk, drawn by what they are doing now, a click away from their work, with a list of everyone and their state; follows local day and night.

## Shell A3 · Desk

- A 56px icon **rail** with the seven surfaces; a toggle at its foot expands it to show each one's name beside its icon, the choice kept in this browser.
- A top bar: the title, the Project filter, search, **Create**, the fire alarm, the user menu and the Chat button.
- **Create** is one window, Task or Idea chosen at its top, each starting in the Project of the page or the one the filter shows; it is the one place to create either, as Work has no "+ Task".
- The top bar's user menu holds the signed-in user's name, **Account** and **Sign out**.
- The Chat button with no Thread open goes to the holder of Default person to talk to, or to the Caretaker while nobody holds it.
- Chats open in the chat drawer, a side panel on the right edge ([thread.md](screens/thread.md), [4.1](4.1-ui-rules.md#the-chat-drawer)); the Needs you panel opens Decisions and Gates anywhere ([decision-card.md](screens/decision-card.md)).
- A fixed **status strip**, each figure a label over its value ([the design](../design/status-strip.html)): on the left, never hidden: needs you, the 5-hour window, desks in use and tokens today; the fire alarm after them while it is on.
- The 5-hour window figure: one engine's 5-hour window with its meter, reset time and 7-day window; each engine's 5-hour window for two or three engines; the highest 5-hour window and a count for four or more; amber from 90% and red when used up; a press on it lists each engine's windows and reset times.
- On the right: the **Workstation figure**, the CPU use now and the logical cores of the computer The Office runs on, opening a panel with its CPU, memory, The Office's own memory and uptime, refreshed every 2 s while the tab is visible.
- Also on the right, one slot of a fixed width for what The Office tells the user (its Notifications, reconnecting, a scheduled update, the desktop notifications ask): its newest by a short line, the rest in a list.
- The status strip lays itself out by its own width and takes a second row under 600px.
- Content is three panels filling the width, folding to two then one; every item is a card with air around it.
- **Each block's left edge is coloured by its type or status**, a deliberate deviation from the design system.

## Side panels

- The side panels are the chat drawer, the Needs you panel, the Activity panel and the conversation's drawer on a narrow Task or Initiative page.
- One of the Needs you panel, the Activity panel and the conversation's drawer is open at a time: opening one closes the others.
- The chat drawer stays open as one of them opens, and that one covers it.
- Opening the chat, whatever opens it (the Chat button, a Proposal or a Decision in a chat, a Link card, Ask in chat, an address with `?chat=`), closes the Needs you panel, the Activity panel and the conversation's drawer, so the chat is never shown under one.
- Esc closes the side panel opened last, then the next ([4.1](4.1-ui-rules.md#closing-a-window)).

## Project mark

- Every item shows its Project mark and name.
- The mark is chosen when a Project is added and changed at any time in the Project page's Appearance section ([project-page.md](screens/project-page.md)); its colour may be any colour: one of the four offered, or a custom one the user picks, with the label turning dark or white to stay readable.
- The Project filter narrows every surface, never Office-wide numbers or the rail badge.
- An Icon or Logo replaces the mark where set ([2.1.1](2.1.1-projects.md)).

## Progressive disclosure

- Many-times-a-day features are on the surface, daily ones one step away, occasional and rare ones folded where they apply.

## Palettes

- Colour is muted text, borders and surfaces; status colours, accent, badges and icons at the design system's values; dark mode is dark gray; logos in brand colours.
- Aubergine, Lavender, Lagoon and Cobalt tint their surfaces and sidebar more strongly and colour their primary buttons, while the text, accent and status rules still hold.
- Emerald and Citrine each pair tinted surfaces with a contrasting metal or ink: gold buttons and a gold active sidebar item on emerald; indigo buttons on a butter-yellow page with a golden active sidebar item.
- Three layers: the design system's tokens (ramps, type, motion) are never changed; a **palette** remaps the colour aliases (backgrounds, surfaces, text, borders, status); a **density** remaps the spacing, control and text-size aliases.
- Components use aliases only, so a palette or a density changes colours and air, never layout.
- Brand marks use the design system's ramp colours directly, so no palette mutes them.
- The status colours (badges, edges, dots) and the accent are aliases too, but every palette keeps the design system's values.
- Palettes are picked in Account › Appearance or from the rail's Theme menu: **Light** (the default, muted), **Dark** (dark gray, not black), **Graphite** (dark, cool), **Paper** (light and warm, a soft beige), **Midnight** (dark, a deep blue-tinted navy, not black), **Mist** (light, a cool soft blue-grey), **Mocha** (dark, a warm brown-grey), **Sage** (light, a soft muted green-grey), **Aubergine** (dark, a deep plum-violet with lavender buttons), **Lavender** (light, a soft violet page with deep violet buttons), **Lagoon** (dark, a deep teal with sea-green buttons), **Cobalt** (light, crisp white on a clearly blue page with cobalt buttons), **Emerald** (dark, a deep emerald green with champagne-gold buttons and a gold active sidebar item), **Citrine** (light, crisp white on a butter-yellow page with deep indigo buttons and a golden active sidebar item), **Contrast light** (light, off-white surfaces with dark text and strong borders) and **Contrast dark** (dark gray surfaces with light text and strong borders); or following the system, which shows Light or Dark.
- Dark palettes: Dark, Graphite, Midnight, Mocha, Aubergine, Lagoon, Emerald, Contrast dark.
- Light palettes: Light, Paper, Mist, Sage, Lavender, Cobalt, Citrine, Contrast light.
- Dark or light decides which version of a Project's Icon and Logo shows, and anything else that follows the palette shown.
- Contrast light and Contrast dark are the high-contrast palettes: reasonably high contrast, never pure black on pure white. Their `--fg-1`, `--fg-2` and `--fg-3` reach at least 7:1 on `--bg`, `--surface` and `--surface-raised`, and their `--border` at least 3:1.
- Aubergine, Lavender, Lagoon, Cobalt, Emerald and Citrine keep the Ember tint of `--surface-selected`, each as a step of its own page, so a selected item looks the same in every palette; their sidebar stays the page's lightness.
- Midnight, Mocha, Mist, Sage, Aubergine, Lavender, Lagoon, Cobalt, Emerald, Citrine, Contrast light and Contrast dark leave `--brand-ink` to their base.
- In every palette that sets them, `--fg-1` and `--fg-2` reach at least 4.5:1 contrast on `--bg`, `--surface` and `--surface-raised`, and `--primary-fg` reaches at least 4.5:1 on `--primary` and `--primary-hover`.
- The palette and the density are each the signed-in user's own, kept with their account and followed on every device they sign in on ([2.10](2.10-users-and-signing-in.md)).

### Graphite

- Graphite sets every alias Dark sets
- `--bg: #15171A`, `--surface: #1C1F23`, `--surface-raised: #23272C`, `--surface-sunken: #111316`, `--surface-hover: #22262B`, `--surface-selected: #2B2522`, `--surface-inverse: #E3E6EA`;
- `--sidebar-bg: #15171A`, `--sidebar-fg: #A4ABB5`, `--sidebar-active-bg: #23272C`, `--sidebar-active-fg: #E3E6EA`;
- `--fg-1: #D6DAE0`, `--fg-2: #939AA5`, `--fg-3: #6A717C`, `--fg-inverse: #15171A`;
- `--border: #262B31`, `--border-subtle: #212529`, `--border-strong: #343A42`;
- `--primary: #D6DAE0`, `--primary-fg: #15171A`, `--primary-hover: #E3E6EA`;
- `--control-hover: #262B31`, `--control-press: #2E343B`;
- `--neutral-subtle: #23272C`, `--neutral-fg: #939AA5`, `--neutral-border: #2E343B`;
- `--brand-ink: #F4F4F2`.

### Paper

- Paper sets these and keeps Light's values for every other alias (`--primary`, `--primary-fg`, `--primary-hover`, `--surface-inverse`, `--fg-inverse`, `--brand-ink`)
- `--bg: #F3EFE8`, `--surface: #FBF9F5`, `--surface-raised: #FFFFFF`, `--surface-sunken: #EDE8DF`, `--surface-hover: #F6F2EB`, `--surface-selected: #F7E9E2`;
- `--sidebar-bg: #F3EFE8`, `--sidebar-fg: #7A7369`, `--sidebar-active-bg: #E9E3D9`, `--sidebar-active-fg: #2C2823`;
- `--fg-1: #2C2823`, `--fg-2: #6E675E`, `--fg-3: #9A928A`;
- `--border: #E6E0D6`, `--border-subtle: #ECE7DE`, `--border-strong: #D9D2C6`;
- `--control-hover: #EDE8DF`, `--control-press: #E3DDD2`;
- `--neutral-subtle: #EDE8DF`, `--neutral-fg: #6E675E`, `--neutral-border: #E1DBD0`.

### Midnight

- Midnight sets every alias Dark sets
- `--bg: #121826`, `--surface: #182033`, `--surface-raised: #1E2740`, `--surface-sunken: #0E1320`, `--surface-hover: #1D2539`, `--surface-selected: #2B2430`, `--surface-inverse: #E2E7F0`;
- `--sidebar-bg: #121826`, `--sidebar-fg: #A0AABD`, `--sidebar-active-bg: #1E2740`, `--sidebar-active-fg: #E2E7F0`;
- `--fg-1: #D4DBE7`, `--fg-2: #929DB3`, `--fg-3: #667189`, `--fg-inverse: #121826`;
- `--border: #232C42`, `--border-subtle: #1E263A`, `--border-strong: #303A54`;
- `--primary: #D4DBE7`, `--primary-fg: #121826`, `--primary-hover: #E2E7F0`;
- `--control-hover: #232C42`, `--control-press: #2B3550`;
- `--neutral-subtle: #1E2740`, `--neutral-fg: #929DB3`, `--neutral-border: #2B3550`.

### Mocha

- Mocha sets every alias Dark sets
- `--bg: #1A1715`, `--surface: #221E1B`, `--surface-raised: #2A2521`, `--surface-sunken: #151210`, `--surface-hover: #28231F`, `--surface-selected: #33261F`, `--surface-inverse: #EBE4DC`;
- `--sidebar-bg: #1A1715`, `--sidebar-fg: #B0A69B`, `--sidebar-active-bg: #2A2521`, `--sidebar-active-fg: #EBE4DC`;
- `--fg-1: #DDD5CC`, `--fg-2: #A0958A`, `--fg-3: #766C62`, `--fg-inverse: #1A1715`;
- `--border: #2E2824`, `--border-subtle: #28231F`, `--border-strong: #3C352F`;
- `--primary: #DDD5CC`, `--primary-fg: #1A1715`, `--primary-hover: #EBE4DC`;
- `--control-hover: #2E2824`, `--control-press: #37302B`;
- `--neutral-subtle: #2A2521`, `--neutral-fg: #A0958A`, `--neutral-border: #37302B`.

### Mist

- Mist sets these and keeps Light's values for every other alias, as Paper does
- `--bg: #EDF1F5`, `--surface: #F8FAFC`, `--surface-raised: #FFFFFF`, `--surface-sunken: #E5EAF0`, `--surface-hover: #F1F4F8`, `--surface-selected: #F5E8E3`;
- `--sidebar-bg: #EDF1F5`, `--sidebar-fg: #6B7685`, `--sidebar-active-bg: #E1E7EE`, `--sidebar-active-fg: #232A33`;
- `--fg-1: #232A33`, `--fg-2: #5C6775`, `--fg-3: #8D97A4`;
- `--border: #DDE3EA`, `--border-subtle: #E5EAF0`, `--border-strong: #CDD5DF`;
- `--control-hover: #E5EAF0`, `--control-press: #DAE1E9`;
- `--neutral-subtle: #E5EAF0`, `--neutral-fg: #5C6775`, `--neutral-border: #D8DFE7`.

### Sage

- Sage sets these and keeps Light's values for every other alias, as Paper does
- `--bg: #EEF1EC`, `--surface: #F8FAF7`, `--surface-raised: #FFFFFF`, `--surface-sunken: #E5E9E2`, `--surface-hover: #F2F5F0`, `--surface-selected: #F5E9E2`;
- `--sidebar-bg: #EEF1EC`, `--sidebar-fg: #6D7769`, `--sidebar-active-bg: #E2E7DE`, `--sidebar-active-fg: #262C24`;
- `--fg-1: #262C24`, `--fg-2: #5E685A`, `--fg-3: #8F988B`;
- `--border: #DDE3D9`, `--border-subtle: #E5E9E2`, `--border-strong: #CDD5C8`;
- `--control-hover: #E5E9E2`, `--control-press: #DBE1D6`;
- `--neutral-subtle: #E5E9E2`, `--neutral-fg: #5E685A`, `--neutral-border: #D7DDD2`.

### Aubergine

- Aubergine sets every alias Dark sets
- `--bg: #1C1424`, `--surface: #241A2F`, `--surface-raised: #2C2139`, `--surface-sunken: #160F1C`, `--surface-hover: #2A1F35`, `--surface-selected: #3A1F2B`, `--surface-inverse: #EEE6F7`;
- `--sidebar-bg: #1C1424`, `--sidebar-fg: #B3A6C6`, `--sidebar-active-bg: #33264A`, `--sidebar-active-fg: #EEE6F7`;
- `--fg-1: #E6DDF0`, `--fg-2: #A89BBB`, `--fg-3: #7A6D8E`, `--fg-inverse: #1C1424`;
- `--border: #30243F`, `--border-subtle: #281E34`, `--border-strong: #3F3052`;
- `--primary: #CDB8F2`, `--primary-fg: #1C1424`, `--primary-hover: #DCCBF7`, `--primary-press: #BBA2EC`;
- `--control-hover: #30243F`, `--control-press: #3A2C4C`;
- `--neutral-subtle: #2C2139`, `--neutral-fg: #A89BBB`, `--neutral-border: #3A2C4C`.

### Lavender

- Lavender sets these and keeps Light's values for every other alias, as Paper does, except the primary ones it sets
- `--bg: #F0ECF8`, `--surface: #F9F7FD`, `--surface-raised: #FFFFFF`, `--surface-sunken: #E7E1F3`, `--surface-hover: #F4F1FB`, `--surface-selected: #F8E9EC`;
- `--sidebar-bg: #F0ECF8`, `--sidebar-fg: #6B5F82`, `--sidebar-active-bg: #E1D8F2`, `--sidebar-active-fg: #241B33`;
- `--fg-1: #241B33`, `--fg-2: #5E527A`, `--fg-3: #948AAA`;
- `--border: #E1DAEE`, `--border-subtle: #E9E4F4`, `--border-strong: #D1C7E6`;
- `--primary: #5A3D99`, `--primary-fg: #FFFFFF`, `--primary-hover: #6849AB`, `--primary-press: #7455B5`;
- `--control-hover: #E7E1F3`, `--control-press: #DDD5EF`;
- `--neutral-subtle: #E7E1F3`, `--neutral-fg: #5E527A`, `--neutral-border: #DAD1EC`.

### Lagoon

- Lagoon sets every alias Dark sets
- `--bg: #0E1C1E`, `--surface: #132527`, `--surface-raised: #192E31`, `--surface-sunken: #0A1517`, `--surface-hover: #172A2D`, `--surface-selected: #2E2725`, `--surface-inverse: #E0EEEE`;
- `--sidebar-bg: #0E1C1E`, `--sidebar-fg: #9DB6B6`, `--sidebar-active-bg: #1C3A3C`, `--sidebar-active-fg: #E0EEEE`;
- `--fg-1: #D3E6E6`, `--fg-2: #8FAAAA`, `--fg-3: #62807F`, `--fg-inverse: #0E1C1E`;
- `--border: #1F3336`, `--border-subtle: #192C2E`, `--border-strong: #2B4447`;
- `--primary: #7FD1C7`, `--primary-fg: #0E1C1E`, `--primary-hover: #9ADDD5`, `--primary-press: #68C2B7`;
- `--control-hover: #1F3336`, `--control-press: #27403F`;
- `--neutral-subtle: #192E31`, `--neutral-fg: #8FAAAA`, `--neutral-border: #27403F`.

### Cobalt

- Cobalt sets these and keeps Light's values for every other alias, as Paper does, except the primary ones it sets
- `--bg: #E9EEFA`, `--surface: #F6F8FE`, `--surface-raised: #FFFFFF`, `--surface-sunken: #DFE6F6`, `--surface-hover: #EFF3FC`, `--surface-selected: #F5E9EA`;
- `--sidebar-bg: #E9EEFA`, `--sidebar-fg: #5A6789`, `--sidebar-active-bg: #D5DEF5`, `--sidebar-active-fg: #18213A`;
- `--fg-1: #18213A`, `--fg-2: #4E5B7D`, `--fg-3: #8591AE`;
- `--border: #D6DEF0`, `--border-subtle: #E0E6F5`, `--border-strong: #C3CEE8`;
- `--primary: #2343B0`, `--primary-fg: #FFFFFF`, `--primary-hover: #2D50C4`, `--primary-press: #3A5CCC`;
- `--control-hover: #DFE6F6`, `--control-press: #D3DCF2`;
- `--neutral-subtle: #DFE6F6`, `--neutral-fg: #4E5B7D`, `--neutral-border: #CDD7EE`.

### Emerald

- Emerald sets every alias Dark sets
- `--bg: #0C1A15`, `--surface: #11231C`, `--surface-raised: #172C24`, `--surface-sunken: #08130F`, `--surface-hover: #152A22`, `--surface-selected: #33231A`, `--surface-inverse: #E6F0EA`;
- `--sidebar-bg: #0C1A15`, `--sidebar-fg: #A3BBAF`, `--sidebar-active-bg: #3A3320`, `--sidebar-active-fg: #F1E2B6`;
- `--fg-1: #DCEBE2`, `--fg-2: #93AE9F`, `--fg-3: #64806F`, `--fg-inverse: #0C1A15`;
- `--border: #1D332A`, `--border-subtle: #172B23`, `--border-strong: #29453A`;
- `--primary: #E2C27D`, `--primary-fg: #0C1A15`, `--primary-hover: #EBD196`, `--primary-press: #D6B163`;
- `--control-hover: #1D332A`, `--control-press: #254036`;
- `--neutral-subtle: #172C24`, `--neutral-fg: #93AE9F`, `--neutral-border: #254036`.

### Citrine

- Citrine sets these and keeps Light's values for every other alias, as Paper does, except the primary ones it sets
- `--bg: #F7F0D4`, `--surface: #FCF9EC`, `--surface-raised: #FFFFFF`, `--surface-sunken: #EFE6C2`, `--surface-hover: #FAF5E0`, `--surface-selected: #FBE5D5`;
- `--sidebar-bg: #F7F0D4`, `--sidebar-fg: #6E6440`, `--sidebar-active-bg: #EBDFAE`, `--sidebar-active-fg: #26210F`;
- `--fg-1: #26210F`, `--fg-2: #615838`, `--fg-3: #978D68`;
- `--border: #E7DDB5`, `--border-subtle: #EEE6C6`, `--border-strong: #D9CC98`;
- `--primary: #2E3A8C`, `--primary-fg: #FFFFFF`, `--primary-hover: #3A479E`, `--primary-press: #4653AB`;
- `--control-hover: #EFE6C2`, `--control-press: #E6DBB0`;
- `--neutral-subtle: #EFE6C2`, `--neutral-fg: #615838`, `--neutral-border: #E0D4A4`.

### Contrast light

- Contrast light sets these and keeps Light's values for every other alias, as Paper does, except the primary ones it sets
- `--bg: #F5F5F1`, `--surface: #FBFBF8`, `--surface-raised: #FFFFFF`, `--surface-sunken: #E9E9E3`, `--surface-hover: #ECECE6`, `--surface-selected: #F8DCCB`;
- `--sidebar-bg: #F5F5F1`, `--sidebar-fg: #2A2F38`, `--sidebar-active-bg: #DEDFD7`, `--sidebar-active-fg: #12151A`;
- `--fg-1: #14171C`, `--fg-2: #2F3640`, `--fg-3: #454C58`;
- `--border: #7D838D`, `--border-subtle: #B3B7BF`, `--border-strong: #5F6671`;
- `--primary: #1B2F6E`, `--primary-fg: #FFFFFF`, `--primary-hover: #26408F`, `--primary-press: #31509F`;
- `--control-hover: #E2E2DB`, `--control-press: #D4D4CB`;
- `--neutral-subtle: #E9E9E3`, `--neutral-fg: #2F3640`, `--neutral-border: #7D838D`.

### Contrast dark

- Contrast dark sets these and keeps Dark's values for every other alias
- `--bg: #17191D`, `--surface: #1E2126`, `--surface-raised: #272B31`, `--surface-sunken: #111316`, `--surface-hover: #2C3037`, `--surface-selected: #3A2A22`;
- `--surface-inverse: #EEF0F3`, `--fg-inverse: #17191D`;
- `--sidebar-bg: #17191D`, `--sidebar-fg: #CDD2D9`, `--sidebar-active-bg: #31353C`, `--sidebar-active-fg: #F4F5F7`;
- `--fg-1: #F1F3F5`, `--fg-2: #CFD4DB`, `--fg-3: #BCC2CB`;
- `--border: #77808C`, `--border-subtle: #545B66`, `--border-strong: #A0A8B3`;
- `--primary: #F1F3F5`, `--primary-fg: #17191D`, `--primary-hover: #FFFFFF`;
- `--control-hover: #343840`, `--control-press: #3F444C`;
- `--neutral-subtle: #272B31`, `--neutral-fg: #CFD4DB`, `--neutral-border: #77808C`.

## Densities

- Picked in Account › Appearance or from the rail's Theme menu: **Compact**, **Comfortable** (the default) and **Relaxed**.
- A density changes only these spacing, control and text-size aliases:

| Alias           | Compact     | Comfortable | Relaxed     |
| --------------- | ----------- | ----------- | ----------- |
| `--pad-card`    | `10px 12px` | `16px 18px` | `22px 24px` |
| `--gap-card`    | `6px`       | `12px`      | `16px`      |
| `--pad-row`     | `8px 12px`  | `14px 18px` | `18px 24px` |
| `--pad-page`    | `16px`      | `24px`      | `32px`      |
| `--gap-panel`   | `12px`      | `20px`      | `28px`      |
| `--radius-card` | `6px`       | `10px`      | `12px`      |
| `--text-item`   | `13px`      | `14px`      | `15px`      |
| `--text-body`   | `12px`      | `13px`      | `14px`      |
| `--control-h`   | `24px`      | `28px`      | `32px`      |
| `--line`        | `1.4`       | `1.5`       | `1.6`       |

## Brand

- The Office's own mark is in the rail; Ember is the accent.
- The design system ([design-system/readme.md](../../design-system/readme.md)) is The Office's own component library and tokens, with no brand of its own; The Office's mark is the brand.
- Its components stay as they are and are wrapped in `packages/ui` rather than edited; it is no longer an export from claude.ai.
- Its Sidebar's layout is not used.

## Copy

- UI copy follows the design system: sentence case, no "I" or "we", verb + object buttons.
- Everything an Agent says is content: Agents speak in the first person, and their actions are attributed to the person, never to "System".

## Defaults

### Palette

- Light.

### Density

- Comfortable.

### Rail

- Icons only, 56px; the expanded choice is kept in this browser.
