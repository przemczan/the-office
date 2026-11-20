# Stats

Covers: the Stats page and its two tabs (Tokens and cost, System health), the basic stats, the full stats (Tokens and estimated cost over time, The most expensive, Usage windows over time), the range pickers, the Office-wide badge, the Grafana states and messages, System health's Load now, charts, tables and states.

## Where it is

- Routes: `/stats` (**Tokens and cost**) and `/stats/system-health` (**System health**).
- Open it from the Stats item in the rail (icon `chart-column`), between Projects and the Live view ([shell.md](shell.md)).
- The page title is "Stats"; its crumb is the open tab's label.
- The Project filter in the top bar narrows only the Project-bound blocks; the Office-wide blocks say so ([shell.md](shell.md)).

## Layout

- The head: the title "Stats" and the line "How The Office performs: what it spends, and how well it runs."
- The tab strip: **Tokens and cost**, **System health**; the open tab's range picker sits at the right end of the row, wrapping under the tabs on a narrow page.
- Then the tab's blocks on a 12-column grid.
- Each block is a card named by its heading; until its first answer it shows a loader (rows, bars or lines); a failed read shows an alert in its place.
- Pressing the other tab goes to its route without keeping the range.

## Pickers and charts

- A picker is a segmented control in a named group; on a narrow page (`@container page`) it is a select.
- Stacked bar charts and line charts are one tab stop: the arrow keys step through the points (Shift for ten), Home and End go to the first and last, and each step opens its tooltip.
- **Show as a table** swaps a chart for its table; **Show as a chart** swaps back.
- The badge **Office-wide** marks a block the Project filter doesn't narrow; its tooltip "The Project filter doesn't narrow this: these figures belong to The Office as a whole." shows only while a Project filter is set.
- Estimated cost is always called estimated, in US dollars ("$38.10").
- A day of the basic stats ("office day") and a full-stats step of a day or more are worded in UTC; shorter steps, resets, "since" and the lanes are the browser's time.

## Tokens per day

- Block "Tokens per day", **Office-wide**. Its head has two token counts: "tokens in 30 days" and "today"; cache reads aren't counted in them.
- A stacked bar per office day for the last 30 days, by kind: **Input**, **Output**, **Cache writes**. Under it the strip "Cache reads, not counted".
- **Show as a table**: columns Day, kinds, Total.
- While the full stats are shown, the full chart ("Tokens and estimated cost over time") replaces this block.

## The Tasks with the most tokens this week

- Each row: the Task's title as a link to its Task page, its Project chip, its tokens and a bar against the first.
- Hint: "Stage runs only: a Task's other Threads and Consultations aren't counted."
- Empty: "No Stage has run this week yet."
- The Project filter narrows it. While the full stats are shown, "The most expensive" replaces it.

## Usage windows now

- Block "Usage windows now", **Office-wide**: each engine whose Usage windows are read or not read yet, with its **5-hour window** and **7-day window** as meters (toned as the rail's strip does), the percentage and "resets <when>" (clock today, weekday within the week, day and clock later; nothing while the window hasn't begun).
- "Not read yet" for a window with no reading.
- Empty: "None of your engines has Usage windows."

## This week

- Block "This week" with "since <Mon 16 Nov>".
- **Tasks done**: "Tasks that moved to Done this week, each counted once."
- **Stage retries**: "A Stage run whose Stage already had a run on the same Task."
- With the full stats on, "Usage windows now" and "This week" sit side by side below the full blocks.

## The message

- Without the full stats, a foot message links to `/settings/telemetry`:
  - telemetry Off: "Turn on Grafana in Settings › Telemetry to see more."
  - an own endpoint with no Grafana read address: "Add your Grafana's read address in Settings › Telemetry to see more."
  - set by the environment: "The environment sets telemetry, so Stats shows the basic stats only." with "Remove the OTEL_ variables to choose in Settings › Telemetry".
- The section is named "The full stats"; when full stats are on offer it says "Estimated cost by model, Role, Stage, Pipeline and Project, the most expensive Tasks and Initiatives, and how full the Usage windows were over time."
- No message while Bundled Grafana, or an own endpoint with a Grafana read address, is chosen.

## The full stats

- The range picker "Range": **24 h**, **7 d**, **30 d**, kept in the address as `?range=` (7 d left out).
- Under it the coverage line: "The full stats cover what The Office has sent Grafana since it started sending it." (it names no date).
- Then, in order: Tokens and estimated cost over time, The most expensive, Usage windows over time, then Usage windows now and This week side by side.
- Until the first answer, the full layout shows loaders ("Loading the full stats…"); a new range or split keeps the last answer with loaders over the blocks.
- The full stats are read every minute, every 3 s while Grafana starts.

## Tokens and estimated cost over time

- Controls: **Measure** (**Tokens**, **Estimated cost**) and **Split by** (**Model**, **Role**, **Stage**, **Pipeline**, **Project**; sent as `split=`).
- A stacked bar per step, the five largest values and **Other**; a legend with each value's total; the head "4.2M tokens · $38.10 estimated · 7 days"; each step's tooltip; **Show as a table**.
- A group with no value reads "No model", "No Role", "Not in a Stage", "No Pipeline" or "No Project".
- Empty: "Nothing ran" with "No engine call in the last <24 hours|7 days|30 days>."
- The step is the service's (7 d goes by 6 hours); a step of a day or more starts at midnight UTC.

## The most expensive

- Control **Show**: **Tasks** or **Initiatives**; a line says "the N with the most estimated cost in <range>" (10 when none is set).
- Each row: a link to the Task (`/tasks/<id>`) or Initiative (`/work/initiatives/<id>`), its Project chips, the estimated cost, tokens and a bar against the first; its Stage runs and retries ("N Stage runs · M retries") and "Retries: $4.10, 18%" counted from its tries.
- A fold on each row (button with `aria-expanded`, label "Cost per Stage: <title>") shows each Stage's tries ("Run 2 · retry · $0.90") and "Outside a Stage"; an Initiative's fold shows its Tasks and "The Initiative's Threads".
- Empty: "No Task has had an engine call in the last <range>." (or "No Initiative …").
- The Project filter narrows it.

## Usage windows over time

- Block "Usage windows over time", **Office-wide**: control **Engine** (one at a time, the fullest now first) and a line chart of its 5-hour and 7-day windows with guides at **90%** and **100%** on the range's time axis. **Show as a table**.
- When Grafana holds no reading of the engine: "Not read yet: Grafana holds no reading of this engine's Usage windows."
- Under it, "What was running on <engine>": a lane with one row per Task of its Stage runs, each bar in its Project's mark colour; a bar's tooltip says when (a stretch such as "Mon 16 Nov, 14:05–14:40", or "still running"), the Task and the Stage, and links to the Task; it has its own table. Empty: "Nothing ran on <engine> in the last <range>."

## Grafana states of Tokens and cost

- The basic stats stay in every state; the alert shows above them:
  - starting: "Grafana is starting…", "The first start pulls its image, which can take a few minutes.";
  - couldn't start: "The bundled Grafana couldn't start", with a link to Settings › Telemetry;
  - unreachable: "Couldn't reach Grafana at <address>" (or "No answer from Grafana."), a link to Settings › Telemetry and **Try again**;
  - refused: "Grafana refused the read token": "Grafana at <address> answered 401. Give a Viewer service account token in Settings › Telemetry.", with the link;
  - no data: "Grafana has no data from The Office yet.", "The full stats start with the next engine call."
- Loading the basic stats: "Loading the basic stats…". A failed read shows an alert.

## System health tab

- Office-wide throughout: the Project filter doesn't narrow it.
- The range picker: **1 h**, **24 h**, **7 d**, **30 d**, kept in the address as `?range=` (1 h left out).
- The source line:
  - 1 h: "From The Office's own Health readings: one every 5 seconds since it started at <time>, kept in memory for an hour." and "Updated <time> · every 5 seconds" with a live dot;
  - longer: "24 h, 7 d and 30 d cover what The Office has sent Grafana since it started sending these measurements." and "Updated <time> · every minute";
  - after a failed read: "Last answer <time>".
- "Loading System health…" until the first answer.
- A read that fails shows the alert "Couldn't read System health": "The Office didn't answer within 10 seconds." (with "The figures below are its last answer, from <time>." when there is one), with **Try again**, above the last answer.

## Load now

- Block **Load now**, "the same on every range": three figures:
  - **Sessions running**: "Engine sessions working now: in Stages, chats and Threads."
  - **Stage runs running**: "Agent and Script Stages running now, on any Task."
  - **Browser connections open**: "Browser tabs following The Office's events now, from every signed-in device."

## Responsiveness

- Chart "Event loop lag" with **p99** and **Max**, a dashed guide "100 ms: answers feel late"; amber from 100 ms. Head: "<time> p99 now" on 1 h, "<time> highest p99" on the longer ranges.
- Note: "How long The Office's own work waited for its turn: the event loop lag. Above 100 ms, pages and Threads answer late. A long wait usually lines up with the slowest routes and queries below."
- **Show as a table** with columns "Event loop lag, p99" and "Event loop lag, max".

## CPU and memory

- Three charts (stacked on a narrow page): **The Office's CPU** ("of one core"), **The Office's memory** (**In use**, **Heap used**), and **The workstation** (**CPU**, **Memory**; "Of the workstation").
- Mini figures read "now <figure>" on 1 h, "highest <figure>" on the others.
- Note: "The Office's CPU is measured against one core: near 100%, its work queues up. Memory in use is what the workstation gave The Office; the heap is what its JavaScript holds."

## Requests

- Head: "<N> requests in the last hour · p95 <time>"; charts **Requests a minute** and **p95 time**; **Show as a table**.
- Foot: "Each route by its template, such as /api/tasks/:id, never the address asked for, so one route is one row however many Tasks it served."

## Database

- Head: "<N> queries in <range> · p95 <time>" and "up to N queries waited for a connection" or "none waited for a connection"; charts **Queries a minute**, **p95 time**, **Waiting for a connection** (the longest wait); **Show as a table**.
- Foot on 1 h: "A statement's shape has its values and parameters made ?, its IN lists and VALUES rows made one ?, and is cut at 200 characters. The Office keeps the 500 shapes seen most."
- Foot on the longer ranges: "Grafana keeps queries by operation and table only, never their statements. Pick 1 h to see each statement's shape."

## Slowest routes and queries

- **Slowest routes** ("by total time: what kept The Office busiest"; columns Route, Requests, p95, Max, Total time) and **Slowest queries** (1 h: "by total time, each statement by its shape", column **Statement shape**; longer ranges: "Slowest queries, by operation and table", column **Operation and table**).
- Each figure column's head is a button ("Sort by <column>") with `aria-sort`; largest first. The first 10 rows show, then **Show all N** / **Show the first 10**.
- A route no route answered reads "Unmatched: no route answered".
- Foot: "<N> routes · <total> in all; the % is each one's share of it." (also "statement shapes", "operations and tables").
- Empty: "No request in <range>. Each route shows here once The Office answers one." and "No query in <range>. Each statement shape shows here once The Office runs one."

## Charts of System health

- A gap where points are more than 1.5 steps apart or a figure is missing; the time before the first point is hatched ("Before this start" on 1 h, "Nothing sent yet" otherwise); guides are dashed.
- "Nothing read yet. The first Health reading comes within 5 seconds of The Office starting." while no reading exists.
- Every chart has a spoken summary: "<title> over <range>: <name> at most <figure>. Use the arrow keys to read each reading|step."
- Figures: times as "9.1 ms", "1.84 s"; total times as "4 min 11 s"; memory as "372 MB" or "1.25 GB"; counts as "1,184", "18.4k" from 10,000; "–" for a figure nothing measured.

## States on the longer ranges

- 24 h, 7 d and 30 d read Grafana, so its states show as on Tokens and cost: starting, couldn't start, unreachable, refused, no data. They sit on a card "The longer ranges" with the text "24 h, 7 d and 30 d read the measurements The Office sends Grafana. The last hour needs no Grafana: it comes from The Office's own Health readings." and **Show the last hour**.
- Without Grafana: "24 h, 7 d and 30 d show once Grafana answers." Before the first export: "24 h, 7 d and 30 d show once The Office's first export arrives." No data: "24 h, 7 d and 30 d start with The Office's next export, within a minute."
- A block whose part of the answer didn't come shows Unreachable's words.

## States

- Narrow window: pickers become selects; the tabs' picker wraps under them; the CPU and memory charts stack.
- Loading, empty and error words are under the blocks above.

## Domain facts

- The page, tabs and the Project filter: [2.11.1](../2.11.1-the-stats-page.md).
- Basic and full stats, estimated cost, Grafana states: [2.11.2](../2.11.2-tokens-and-cost.md).
- System health: [2.11.3](../2.11.3-system-health.md).
- Telemetry settings that choose Grafana: [settings.md](settings.md#telemetry).
- Usage windows: [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).
