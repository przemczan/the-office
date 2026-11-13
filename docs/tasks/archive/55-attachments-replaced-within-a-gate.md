# 55 · Progress log

- 2026-11-13 · step 1: an Agent's file from the same worktree path replaces its earlier copy until the user acts at a Gate (spec 2.1, migration 0135, `attachFromWorktree`, `TaskGates` port to Pipelines' `TaskGateRuns`, `attachment.replaced`); next step 2
- 2026-11-13 · step 2: open pages follow a replaced Attachment: `attachment.replaced` moves its content URL to the next copy (`?copy=N`, `AttachmentCopies`), refetches Attachments, text and search; content route answers `Cache-Control: no-cache`; next step 3
