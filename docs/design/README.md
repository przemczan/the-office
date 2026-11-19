# Designs

Each page here is an interactive mock-up, one self-contained file you open in a browser, and the UI spec for the screen named; where an entry says "Built differently", the code wins.

- [task-page-2.html](task-page-2.html): the UI spec for the Task page (Pipeline rail, Needs you and Before Ready, tabbed record, conversation).
- [thread-dialog.html](thread-dialog.html): the UI spec for how a Thread reads (the Rows design, as in a team channel).
- [chat-drawer.html](chat-drawer.html): the UI spec for the chat drawer.
- [decision-form.html](decision-form.html): the UI spec for the Decision card. Built differently: a Decision put to a Consultant has its form locked until the user presses Take it over, which only unlocks it; and in the window the last question has Submit in Next's place.
- [add-project.html](add-project.html): the UI spec for Add a Project, with Recent first as the GitHub list.
- [project-appearance.html](project-appearance.html): the UI spec for a Project page's Appearance block (Icon and Logo, with How it looks).
- [board-by-initiative.html](board-by-initiative.html): the UI spec for Group by Initiative on the Work board. Built differently: the board keeps its six columns in one row, scrolling sideways, the groups together under one row of column heads.
- [board-initiative-blocks.html](board-initiative-blocks.html): the UI spec for the Work board's columns with Group by Initiative off. Built differently: the block's fill is one rule for every palette, and a Task whose Initiative the board hasn't read yet shows loose.
- [task-page-2.html](task-page-2.html) addendum, not drawn in the file: a Task whose pull request ended shows a "Pull request merged" or "Pull request closed" badge beside Open pull request, and its record a line such as "Pull request #12 merged (squash) by the user Ann Lee on …". Work › Pull requests rows gain **Merge…** (method choice, with the recommended one, GitHub's refusals in words, whether GitHub deletes the branch) and **Close…** dialogs; neither is drawn.
- [task-card-icons.html](task-card-icons.html): the UI spec for the Work board's Task card (Foot row). Built differently: the queue's place count is in the popover, not on the card, and there is no Failed mark.
- [initiatives-tab.html](initiatives-tab.html): the UI spec for the Initiatives tab and the Archived tab's Initiatives (the Board).
- [initiative-page.html](initiative-page.html): the UI spec for the Initiative page. Built differently: each Project's Pipeline choice also offers that Project's own Project Pipelines, grouped as a Task's picker groups them.
- [task-page-2.html](task-page-2.html) and [initiative-page.html](initiative-page.html) addendum, not drawn in the files: the head's actions hold **Browse files**, which opens the Project's Files tab on the Task's or the Initiative's branch while that branch exists on this workstation ("Browse files in <Project>" for each Project of an Initiative spanning several).
- A Project page's Files section has no design of its own: it is built from [§4](../spec/4-ux-direction.md#defaults) ("The Files tab") and the [UI rules](../spec/4.1-ui-rules.md).
- [status-strip.html](status-strip.html): the UI spec for the status strip under the top bar. Built differently: a slot's list opens under the slot from its left edge, kept inside the window, and the slot shows no tooltip on hover.
- [sub-agents-and-processes.html](sub-agents-and-processes.html): the UI spec for a session's Sub-agents and Processes line and view. Built differently: a Process's shell isn't shown, and its window keeps one height.
- [session-context.html](session-context.html): the UI spec for the context reading above the message input.
- [loaders.html](loaders.html): the UI spec for the shared loader of a block whose data hasn't arrived yet.
- [stats.html](stats.html): the UI spec for the Stats page: its two tabs, Tokens and cost (the basic and full stats, and Settings › Telemetry's Stats group) and System health (its ranges, blocks and states).
- [live-view.html](live-view.html): the UI spec for the Live view.
- [pipeline-flow.html](pipeline-flow.html): the UI spec for the Pipeline flow editor in Settings › Pipelines and a Project page's Pipelines section. Built differently: a picked Stage's Save as template and Remove are in its ⋯ menu, and a removed Stage isn't drawn on a Proposal's flow.
- [project-pipelines.html](project-pipelines.html): the UI spec for a Project page's Pipelines section and Settings › Pipelines (Built on by, Make it the default, the picker).
- [initiative-pipelines-block.html](initiative-pipelines-block.html): the UI spec for the Initiative page's Pipelines block.
- [pipeline-editor.html](pipeline-editor.html): the UI spec for Settings › Pipelines' two tabs (Pipelines and Stage templates, each a list beside its open item) and for the flow editor's canvas in Settings, a Project page's Pipelines section and a Task's Stages window: it pans and zooms, with Fit, the Overview and full screen. Where it differs from pipeline-flow.html, this one wins; the pages around the editor stay as project-pipelines.html and the code have them.
