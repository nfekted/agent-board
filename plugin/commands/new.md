---
description: Create a kanban card in the queue
argument-hint: <title> [scope] [link: https://...]
---

Create a card from: `$ARGUMENTS`

- The first word or quoted phrase is the card title; a part starting with `link:` is the external tracker link (http/https only); the rest is the scope. If the title is missing, ask for it.
- Call `kanban_create` with the title, scope and externalUrl (if any). If it reports a duplicate title, tell the user and ask for another.
- Confirm in one line. Do NOT start the card.

Reply in the user's language.
