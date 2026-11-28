# Activity

Covers: the Activity panel, its Sessions section by person or by subject, a session row and its state, the Other running work groups, the Project filter on it, states.

## Where it is

- A drawer titled "Activity" over any page, opened from the status strip's [Activity figure](shell.md#status-strip); it has no rail entry and no page of its own.
- It lives in the address as `?activity=true` on the page under it; the old address `/activity` opens Now with the panel.
- Its description counts Office-wide, as the figure does: "N sessions, M other running".
- Its left edge resizes it (handle "Resize the Activity panel"); its width is kept in this browser, and at a narrow window it fills the window.
- Opening it closes the [Needs you panel](shell.md#needs-you-panel) and a conversation's drawer, and leaves the chat drawer open under it; opening the chat closes it ([4 Side panels](../4-ux-direction.md#side-panels)).
- Esc, a press outside it or its × closes it; following a row's link closes it too.
- It reads `GET /activity` and follows `activity.changed` without a reload.

## Sessions

- The first section, headed "Sessions" with its count of activities; left out while none is listed.
- A switch in its header, **By person** | **By subject**; the choice is kept in this browser (`the-office.activity-grouping`) and never sent to the service. By person is the default.
- **By person**: one entry per person, headed by their Avatar and name, The Office last (its own mark); people are ordered by their latest session's start. Under each, a card per activity they are in, newest first, with only their sessions on it.
- **By subject**: one card per activity (a Task, an Initiative or a chat), in the order `GET /activity` answers, with a row per session: the person, then the session.
- A card names its subject: its title links to the subject, and a Task's card has its Project chip.
  - A Task: its page.
  - An Initiative: its page.
  - A chat: opens that chat Thread in the chat drawer.
- A session's row:
  - its state as a badge: "Working", or "Waiting on you" (a Decision), "Waiting on a Consultant", "Waiting at <Gate>", "Reply waiting";
  - what it is: its Stage name, else "Consultation", "Planning" or "Chat";
  - how long it has been in that state, "Working for 12 min", ticking with the clock; and a Decision's one-line question under it.
- The card's left edge is green while any of its sessions works, amber when all wait.

## Other running work

- A section below Sessions, headed "Other running work", that the switch doesn't change; a group with no items is left out.
- Its groups, in this order:
  - **Test instances**.
  - **Action runs**.
  - **CI runs**.
  - **Off-board Tasks and environment checks**: Onboarding runs, Run environment set-ups and environment checks.
  - **Connected devices**.
  - **Stalled Tasks**: Tasks whose Stage failed or was stopped, never an Off-board Task.
- Each kind of [Activity item](../2.14-activity.md#other-running-work) is in exactly one group; in each, the newest by when it entered its state comes first.
- An item is a card named "<state>: <title>": the title, a link to where it lives; the Project chip; the state as a badge; an Off-board Task's kind ("Onboarding run" or "Run environment set-up").
- Under it a line with what the item adds (the Stage a stalled Task failed or stopped in; an Off-board Task's "Place N · <short reasons>" while Queued, else its Stage and "<N> tokens"; a test instance's branch), then how long it has been in its state: "Running for 18 min". It ticks with the clock.
- The card's left edge: red when its state is a failure, amber when it waits, is paused or stopped, green otherwise.
- Where the title links:
  - a stalled Task, an Off-board Task and a Connected device: the Task's page;
  - a test instance: its Initiative's page, or the Project's Test targets when it has none;
  - an Action run: the Action in its Project's Actions;
  - a CI run: the CI tab, with its run on the code host beside it ("Open on the code host");
  - an environment check: the Project's Environment.

## Project filter

- The [Project filter](shell.md#project-filter) narrows Task activities and other running work; Initiatives and chats always show.
- At the panel's foot, the "N more items in other Projects" note counts what it leaves out.

## States

- Loading: a block loader of rows, "Loading Activity…".
- Empty: "Nothing is running." with "Sessions, test instances, CI runs, environment checks, Off-board Tasks, Connected devices and stalled Tasks show here while they run."
- Empty in the Projects shown, while other Projects have items: "Nothing is running in these Projects.", with the in-other-Projects note.

## Domain facts

- What is listed, since and the count: [2.14 Activity](../2.14-activity.md#activity).
