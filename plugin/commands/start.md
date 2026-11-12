---
description: Start a kanban card (queue -> planning -> doing)
argument-hint: <card title>
---

Start the card: `$ARGUMENTS`

Load and follow the `kanban-workflow` skill, section "Start flow". If the card is already in planning, resume from its `planningStep`; if it is in doing or validation, say so and ask what the user wants instead of restarting it.

Reply in the user's language.
