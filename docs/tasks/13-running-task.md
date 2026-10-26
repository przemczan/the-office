# 13 · A running Task: barge-in, Stop, Pause, Decisions, Office tools

Status: todo

## Goal

The user steers a running Task and its Agents reach the user only through the record. The user writes into a running Stage Thread and it lands at the next safe point; Stop interrupts now and Pause holds after the current step. Agents on a Stage open Decisions, consult (which in tier 1 always asks the user), attach files and leave Handover notes through Office tools, and follow the Hard switches their brief states.

## Definition of Done

- [ ] A message written into a running Stage Thread is delivered with `next` priority, the composer says it lands at the next safe point, and the Agent acts on it in the same session. Check: a live run on the Test Project, and a scripted-adapter test.
- [ ] Stop interrupts the session now, discards the Stage's uncommitted edits and holds the Task as Paused; Pause holds it after the current step; Resume continues through the Context policy and the label says how. Check: tests of each, and Stop on a live run.
- [ ] Shutting The Office down ends running sessions at once, the same way Stop does, rather than waiting for their Stages to end; at the next boot a Stage run left running ends as failed "The Office restarted during this Stage" and opens a Decision (run it again / drop); it is never re-run silently, and Stop and Pause follow the same interrupted-run rule. Check: a test that closes the service during a running Stage and finds the session ended at once, and a test that boots with a running run.
- [ ] Office tools on Stages: open a Decision, consult *person* (in tier 1 it becomes a Decision for the user, since nobody else is hired), attach a file or link as an Attachment of the Task, and write the Handover note into the result. Check: a scripted-adapter test per tool, and the Attachment on the Task page.
- [ ] The followed Hard switches (run installs, publish outside the Pipeline) are stated in the brief in plain words from the Role card's values: Allowed, Consult *person* and Ask me send the Agent to the consult tool first, which asks the user and answers allow once or deny; Never says it is not allowed. A Decision never grants "always". Change Roles is an Office tool no tier 1 Role is given, and git stays enforced by the hook of task 06. Check: the brief's text per value, and a scripted-adapter test of an install asked for and denied.
- [ ] Waiting on you shows on the Task and the board while any Decision on it waits; answering resumes the Stage. Check: Playwright answers a Decision on a running Task.
- [ ] Tokens per Task and per Thread update live on the Task page. Check: watch a run.

## Read first

- [Spec §2.4](../spec.md#24-conversations) (barge-in, Stop, Pause, only work starts a conversation), [§2.3](../spec.md#23-pipelines) (who is asked), [§6](../spec.md#6-permissions-and-safety) (Hard switches, the consult tool, "a missing person falls back to the user").
- [engine-check.md](../engine-check.md): priority and interrupt.
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §11.3 (discarding an interrupted Stage's edits), §11.7.
- Click-through: Pause, Stop and Resume in [app/task.js](../../.scratch/the-office/prototypes/app/task.js); the running Thread and composer in [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js).
- Carried over from task 10: an Office tool knows only its session's id. Work's `SessionPeople` port (who is at work in a session) is bound in `AppModule` to Conversations' `ThreadService.personInSession`, which knows chat sessions only, so a Stage session calling `capture_idea` or `create_task` is answered "The Office doesn't know whose session this is." The Stage tools here (attach, Decisions, the Handover note) need a binding that also covers Stage sessions, and a way from the session to its Task and Stage.

Leave out: Consultations with colleagues (the consult tool only asks the user in tier 1), the fire alarm, and the CTO's first look at failures.

## Steps

- [ ] 1. Barge-in: the composer on a running Stage Thread sends with `next` priority; the log marks the message delivered when it lands. Commit.
- [ ] 2. Stop, Pause and Resume in Pipelines: interrupt and discard, hold after the current step, resume through the Context policy; the states and events on the Task. Commit.
- [ ] 3. Interrupted runs: shutdown ends running sessions at once, the same way Stop does (today `StageInterpreter.onModuleDestroy` waits for a running Stage to end); at the next boot, a Stage run left running ends as failed "The Office restarted during this Stage" and opens a Decision (run it again / drop); never re-run silently. Stop and Pause share the same interrupted-run rule. Commit.
- [ ] 4. Office tools for Stages: open a Decision and consult wait the way task 11 built (the tool returns at once, the answer arrives as the session's next message); consult opens a Decision for the user naming who would have been asked; attach; the Handover note. Commit.
- [ ] 5. Hard switches: the followed ones written into the brief from the Role card, each value's wording tested. Commit.
- [ ] 6. The Task page and board: Waiting on you, the Decision in the Stage Thread, Pause, Stop and Resume, live tokens. Commit.
- [ ] 7. Check on the Test Project: run a Task, barge in once, answer a Decision, Pause and Resume, Stop once and resume fresh; log what each did. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
