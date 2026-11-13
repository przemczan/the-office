# 55 · An Agent's Attachment is replaced, not repeated, until the next Gate

Status: done

## Goal

A Gate shows each file an Agent attached once, at its latest copy. Found by the user on 2026-11-13: a Design Stage attaches `design.html`, Review sends the work back, Design attaches `design.html` again, and the Gate shows two. Every `attach_file` call (and every screenshot a Stage result lists) adds a new Attachment today (`AttachmentService.addFile`).

Chosen by the user on 2026-11-13, a small part of the postponed Attachment versions (task 39), not the whole of it:

- An Agent attaching a file to a Task **replaces** the Attachment an Agent attached from the **same worktree path** to that Task **since the user last acted at a Gate on the Task** (Continue, Send back or any other Gate action; before any, since the work started). What a Gate already showed the user is never changed.
- The replaced Attachment keeps its **id** (Briefs, Decisions and links that name it still work) and its **place** (`addedAt`, so its round and the Gate run showing it stay the same); its bytes, size, media type, text judgement, a PDF's text and a document's searched text are the new file's, and `addedBy` is who attached it last.
- Screenshots attached from a Stage result follow the same rule, by their worktree path. Links are never replaced. Nothing the user attached is ever replaced, nor anything on an Idea or an Initiative.
- The Agent is told: "Replaced <name> (Attachment <id>) with the new copy." instead of "Attached …".

## Definition of Done

- [x] Spec 2.1's Attachment line says the rule above, as the user's answer of 2026-11-13. Check: read the changed line against Goal.
- [x] An Agent's `attach_file` of the same path twice before a Gate leaves one Attachment with the second copy's bytes and the first one's id and `addedAt`; after the user acted at a Gate, the same path adds a new one. Check: `attachment-service` / office tool tests on Postgres.
- [x] A user's upload, a link, a different path and another Task are never replaced. Check: the same tests.
- [x] Screenshots from a Stage result replace by path the same way. Check: `stage-screenshots` test.
- [x] Open pages show the new copy without a reload: the Attachments tab, the Gate's list, an open preview or document window, and search finds the new text. Check: web unit tests; one e2e test if the module has one for Attachments.
- [x] `npm run verify` passes.

## Read first

- `apps/service/src/modules/work/MAP.md` (Owns: Attachments; Traps: `attachment_texts`, the content route) and `apps/web/src/surfaces/work/MAP.md`.
- Spec 2.1, the Attachment line (line 19).

## Leave out

- Keeping the replaced copy, or showing versions: task 39, after tier 3.
- Replacing by name, or anything the user attached.
- A "replaced" mark or time on the Attachment in the web.

## Steps

- [x] **1. Service.** Spec 2.1 amended. A migration adding the source path (worktree-relative, null for the user's uploads and older rows) to `attachments`. `AttachmentService` gets a replace use case: in Work's domain, the rule that picks the Attachment to replace (owner a Task, added by a person, same path, added after the Task last waited at a Gate); the bytes and PDF text written before the row as `addFile` does, `attachment_texts` updated, and an `AttachmentReplaced` event (with the web event). When the Task last waited at a Gate comes from Pipelines through a new Work port, bound in `app.module.ts` the way `StageResults` is (Pipelines calls Work, so never import Pipelines from Work); the boundary is the end of the last Gate run done, not skipped, and acted on by the user (see State). `attach_file` and `StageScreenshots.attach` pass the path and word the answer. Read: `attachment-service.ts`, `domain/attachment.ts`, `domain/attachment-changes.ts`, `domain/attachment-events.ts`, `postgres-attachment-repository.ts`, `attachment-office-tools.ts`, `stage-screenshots.ts`, `work-web-events.ts`, Pipelines' `domain/gate.ts`, and how `StageResults` is bound.
- [x] **2. Web.** The contracts' web event for a replaced Attachment; the Task's Attachments, the Gate's list and search refetched on it; an open preview or document window loads the new bytes (the content URL must not serve the old copy from the browser's cache: check the route's cache headers and the URL the web builds). Read: `apps/web/src/surfaces/work/MAP.md`, `attachments-block.tsx`, `shell/attachments/`, the web event handling for `AttachmentAdded`.
- [x] **3. Close.** `npm run verify`, the log archived, the README row done.

## State

Done. Service (step 1) and web (step 2) as in the log; the rule is in spec 2.1.

Verified: on the workstation `npm run verify` ran clean through typecheck, lint, format, maps, build, the web tests, the tools' tests, e2e (34) and the service start check; the service tests failed only in 5 tests of modules this task didn't change, each failing the same way alone (Windows paths in two Publishing tests, the container runtime in Run environments), now on the README's after-tier-3 list. One 5 s timeout in Conversations passed alone.

Not covered: a copy replaced while the event stream was down shows after a reload. No e2e drives an Agent's `attach_file`; `replaced-attachment.test.tsx` covers the web. Not seen live: no real session has attached the same file twice yet.

## Progress

The log is in [archive/55-attachments-replaced-within-a-gate.md](archive/55-attachments-replaced-within-a-gate.md).
