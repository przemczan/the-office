# Progress log: 16 · Now, the status strip and Notifications

Moved from [16-now-notifications.md](../16-now-notifications.md) when the task was done. One line per commit, newest last.

- 2026-10-27 · step 1: the Notifications module with Now's read model (GET /now, POST /activity, `now.changed`), its tables and the user's answers as spec Defaults; next, Now and the strip in the web.
- 2026-10-27 · step 2: Now and the strip in the web from the `now` query, answering Decisions and Gates in place, activity reported; the Gate's actions moved to the shell; next, the Needs you panel.
- 2026-10-27 · step 3: the Needs you panel, a Drawer over any page opened from the strip, answering Decisions and Gates there; next, the kinds tree and routing.
- 2026-10-27 · step 4: Notifications raised from the other modules' events with the kinds tree's routing, kept until their item is handled, and sent to the web; next, the channel adapters in the web.
- 2026-10-27 · step 5: the web's channels behind one port (toast, title and favicon, strip; desktop while the tab isn't focused) and the web's own "service down"; next, the check on the Test Project.
- 2026-10-27 · step 6: the Test Project check passed (a budget Decision, a Gate and a Done Task, seen on Now and as Notifications, each cleared once handled); "service down" checked by cutting the event stream; next, close the task.
