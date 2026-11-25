# Activity

Covers: the Activity panel, its groups (Off-board Tasks and environment checks among them), an item and its time in state, the New mark and how an item is seen, the Project filter on it, states.

## Where it is

- A drawer titled "Activity" over any page, opened from the status strip's [Activity figure](shell.md#status-strip); it has no rail entry and no page of its own.
- It lives in the address as `?activity=true` on the page under it; the old address `/activity` opens Now with the panel.
- Its description counts Office-wide, as the figure does: "N running[, M ended not yet seen]".
- Its left edge resizes it (handle "Resize the Activity panel"); its width is kept in this browser, and at a narrow window it fills the window.
- Opening it closes the [Needs you panel](shell.md#needs-you-panel) and a conversation's drawer, and leaves the chat drawer open under it; opening the chat closes it ([4 Side panels](../4-ux-direction.md#side-panels)).
- Esc, a press outside it or its × closes it; following an item's link closes it too.
- It reads `GET /activity` and follows `activity.changed` without a reload.

## Layout

- One panel per group that has items, headed by the group's icon, its name and its count; a group with no items is left out.
- In each group the running items come first, then the newest by when it entered its state.
- At the panel's foot, the "N more items in other Projects" note while the [Project filter](shell.md#project-filter) leaves items out.

## Groups

- In this order:
  - **Tasks**: Tasks at a desk.
  - **Test instances**.
  - **CI runs**.
  - **Off-board Tasks and environment checks**: Onboarding runs, Run environment set-ups and environment checks.
  - **Connected devices**.
  - **Pull requests**: those ready to merge.
  - **Stalled Tasks**: Tasks whose Stage failed or was stopped, never an Off-board Task.
- Each kind of [Activity item](../2.14-activity.md#what-is-listed) is in exactly one group.

## An item

- A card named "<state>: <title>": the title, a link to where the item lives; the Project chip; the state as a badge; a New badge while unseen.
- Beside the state, an Off-board Task's item names its kind: "Onboarding run" or "Run environment set-up".
- Under it a line with what the item adds (the Stage a stalled Task failed or stopped in; an Off-board Task's "Place N · <short reasons>" while Queued, else its Stage and "<N> tokens"; a test instance's branch; a pull request's "#N"), then how long it has been in its state: "Running for 18 min", "Failed for 2h 10 min", from a day on "Ready for 3 days". It ticks with the clock.
- The card's left edge: red when its state is a failure, amber when it waits (Waiting on you, a CI run waiting, a device waiting for the run environment), is paused or stopped, green otherwise.
- Where the title links:
  - a Task, a stalled Task, an Off-board Task and a Connected device: the Task's page;
  - a test instance: its Initiative's page, or the Project's Test targets when it has none;
  - a CI run: the CI tab, with its run on the code host beside it ("Open on the code host");
  - an environment check: the Project's Environment;
  - a pull request: the Pull requests tab, with the pull request on the code host beside it.

## Seen

- An ended item the user hasn't [seen](../2.14-activity.md#seen-per-user) has the New badge and an accent tint.
- It counts as seen once at least half its card has been in view for 1 s while the tab shows and the window has focus.
- The panel sends the seen items in batches, at most one `POST /activity/seen` a second; a failed send goes again with the next.
- An ended item shown while the panel is open stays in it, without its New badge, though a re-read no longer lists it; the next opening leaves it out.

## States

- Loading: a block loader of rows, "Loading Activity…".
- Empty: "Nothing is running." with "Tasks at a desk, test instances, CI runs, environment checks and Connected devices show here while they run."
- Empty in the Projects shown, while other Projects have items: "Nothing is running in these Projects.", with the in-other-Projects note.

## Domain facts

- What is listed, running and ended, since, seen and the count: [2.14 Activity](../2.14-activity.md#activity).
