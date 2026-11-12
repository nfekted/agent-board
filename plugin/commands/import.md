---
description: Create several cards at once from a notes file
argument-hint: "<file> - notes file: per card: '## title', optional 'link: https://...', then the scope; or a .json from /kanban:export"
---

Import cards from the file: `$ARGUMENTS`

Load and follow the `kanban-workflow` skill. If the file is a `.json` made by `/kanban:export`, use section "Import a shared export"; otherwise use section "Import". Show a preview and create nothing until the user confirms.

If the file does not exist or has no `## ` blocks, say so and show this format:

```
## 1234
link: https://tracker.example.com/1234
project: ~/Node/my-app
Free-text scope of the card, until the next heading.

## Fix login redirect
Scope without a link.
```

Reply in the user's language.
