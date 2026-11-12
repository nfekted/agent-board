# Card order (notes for the future README)

- The order of the cards in a column is their priority: the first one is the next. It is saved on the board, so it survives reloads and other sessions.
- Drag a card up or down inside its column to reorder; drop it between two cards of another column to move it to that place. Dropped at the end, it goes last.
- While the filter field has text the board hides cards, so drops there only change the column (the position is kept as it was).
- Order is kept per column across all projects; in a project view it applies to that project's cards relative to each other.
- Claude: `kanban_list` returns cards in this order; the skill treats the first card of a column as the next one.
