---
description: Stop the kanban daemon (the visual board goes offline until the next kanban command)
---

Call the `kanban_stop` tool and report the result in one line.

Tell the user: the daemon is shared by all Claude sessions, so the board page stops responding in all of them; the cards are kept on disk; any later kanban command (or `/kanban`) starts the daemon again by itself.

Reply in the user's language.
