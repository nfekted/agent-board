# Export / import (notes for the future README)

- Board UI: **Export** (checklist of the cards shown, filter by title, any number of projects; downloads `<name>.kanban.json`) and **Import** (choose the file, one folder per project in the file, skip or rename duplicates).
- Claude: `/agent-board:export` and `/agent-board:import`; the import asks "folder Claude is open in" or "enter a folder".
- File format: version 2. Cards carry title, scope, extras, external link, plan content, project **name** (never a path) and the column they were in. Branch and plan approval never travel. Version 1 files still import.
- Imported cards always land in `queue` with an `imported` mark. Starting one asks "Start from scratch" or "Reuse the earlier work" (skips structuring/extras, plan used as a starting point and still needs approval). The mark is cleared once chosen.
- The folder is typed (browsers do not expose a folder's full path). A folder-browser dialog could be added later.
- User tags (free labels) travel in the file too; they are separate from the `imported` mark and the status badges.
