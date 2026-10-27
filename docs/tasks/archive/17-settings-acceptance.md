# Progress log: 17 · Settings, and the tier 1 acceptance run

Moved from [17-settings-acceptance.md](../17-settings-acceptance.md) when the task was done. One line per commit, newest last.

- 2026-10-27 · step 1: Settings › Office limits edits the Office-wide limit (Work) and the Context policy's size threshold (Conversations), each read at the next Start or continuation; next, step 2, Appearance.
- 2026-10-27 · step 2: Settings › Appearance switches Light, Dark and Follow the system, kept in the browser; next, step 3, the acceptance run on the Test Project with the user.
- 2026-10-27 · step 3: two runs on the Test Project; the second, Full with a Gate added, passed the Gate and published PR #3; the user's findings logged in State. Next, the user's verdict and step 4 on Linux.
- 2026-10-27 · step 4: on the LXC the service starts, adds the Test Project and walks a Quick fix Task with an added Gate to that Gate; nothing differed from Windows. Next, step 5, the problems with their fixes.
- 2026-10-27 · step 5: the user's verdict and the problems the acceptance runs surfaced, each with a proposed fix; tier 1 done. Next, slicing tier 2.

  **The user's verdict:** they would pick The Office over a regular Claude Code session for this piece of work ("not too bad, it worked, not super intuitive, but we can work on that later").

  **Problems, each with a proposed fix:**

  1. **Work board.** A Task card opens only from its title link. Fix: make the whole card the link, with its menu and buttons stopping the click.
  2. **Work board.** The card's "…" menu is clipped when the board is short (one Task, a short Pipeline). Fix: render the menu outside the column's overflow (a portal), flipping up when there is no room below.
  3. **"+ Task".** It asks for a title only, with no word on where the work is described, and the new Task stays closed. Fix: a hint in the dialog ("You describe it when you plan it with the Planner"), and open the new Task's page once it is added.
  4. **Planning.** After "Plan with …" nothing shows until the Planner's first words, so the user can't tell whether to wait or write. Fix: a Thread shows a working indicator ("Jan is reading the Project…") from the moment a turn starts until its first output, in every Thread, not only planning.
  5. **Mark Ready.** It is clickable while it can't succeed and explains only after the refusal. Fix: disable it until the Task can be Ready, beside a "Before Ready" checklist (Plan confirmed, Definition of Done confirmed, Pipeline taken or declined, no Decision waiting), each line ticking as it is met; the refusal reasons become the checklist's lines. Where the checklist sits (the planning panel or the Task page's header) to be settled with the user.
  6. **Mark Ready.** The user expected a Ready Task to be picked up by someone on its own and wanted a confirmation. In tier 1 nothing starts by itself: Start is the user's, refused with the reason at a limit, with no queue (spec 2.1). Fix: say so where Ready is shown ("Ready: start it when you want; nothing starts by itself"). A confirmation belongs with whatever later tier starts Tasks without the user.
  7. **Task page chat tabs.** A Stage session that starts adds its tab and switches to it, and adds it at the end. Fix: add the tab right after the current one and leave the user where they are, with the new tab marked as new.
  8. **Changes tab.** A file's diff is open by default and diffs can't be folded. Fix: every file starts folded to its header with its +/- counts; a click unfolds it; "Unfold all" and "Fold all" above the list.
  9. **Gate.** What the user does at a Gate isn't said, and a Gate's name read as an instruction to the agents ("I need one screenshot"). Fix: the Gate view says "Look at the work so far, then Continue, Send back with feedback, or Drop"; the Stage editor says under a Gate's name that it is a label for the user, not something the agents act on.
  10. **Gate, send back.** A Script Stage can be chosen to send the work back to, and the feedback is silently unused (it only runs again). Fix: when a Script Stage is chosen, say beside it that it is a script and can't read the feedback, it only runs again; default the choice to the latest Agent Stage.
  11. **Chat input.** Enter seemed not to send. The Composer sends on Enter and breaks on Shift+Enter, but does nothing, silently, while the agent is answering; the Decision's free answer and the Gate's feedback are plain text areas without it. Fix: the same keys in every message field, and while busy, Enter shows why it can't send (or the message is queued to send next).
  12. **Markdown.** Messages and handover notes show as plain text, so a handover note is one long line. Fix: render Markdown (sanitised, no raw HTML) in messages, handover notes, Stage outcomes and Decision text.
  13. **Tokens.** A Thread's count adds cache reads, about 90% of it (Planning showed 315k with 274k cache reads), while Stage budgets leave cache reads out. Fix: show the count without cache reads everywhere (Threads, Stages, Now, the strip), with an info icon whose tooltip gives input, output, cache writes and cache reads and says what each costs.

  Also noted, as the spec has it: Devops isn't hired in tier 1 (a tier 2 Role), so an Agent's question for it goes to the user.
