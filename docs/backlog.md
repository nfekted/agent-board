# Backlog column

- Column before the queue for cards that exist but are not for now (e.g. technical debt). It is collapsed by default, showing only the counter; click its title to open it (remembered in the browser). Typing in the filter opens it so matches are visible. A collapsed column still accepts dropped cards.
- Moves: backlog -> queue only, and queue -> backlog. Planning/doing/validation cards go back to the queue first.
- Claude never starts or suggests a backlog card; asked to start one, it asks whether to move it to the queue first. The board refuses backlog -> planning/doing anyway.
- Creating directly in the backlog: `kanban_create` with `backlog: true`, or `status: backlog` in a `.md` import. Imports of `.kanban.json` and `.md` land in the queue otherwise.
