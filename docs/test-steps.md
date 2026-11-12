# Test steps (notes for the future README)

- When the implementation is done, before moving a card to validation, the agent writes a short numbered checklist in the card's `testSteps`: where to go, what to do with concrete values, and the expected result. One line per step, about 3 to 8 steps.
- Shown and editable in the card dialog ("Test steps"); cards that have them show a "test steps" badge. Readable by an agent with `kanban_get`, so another agent can run them as automated tests.
- After adjustments in validation the agent updates the steps for what changed.
- Enforced by the skill only: the board does not block a move to validation without steps. Not part of the export file.
