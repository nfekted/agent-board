# Tags and card filter (notes for the future README)

- Each card has user tags (free text, case-insensitive duplicates merged), shown as badges next to the status badges. Edit them in the card dialog or when creating a card (comma separated); Claude can set them with `kanban_create` / `kanban_update` (`tags`), and `.md` imports accept a `tags:` line.
- The filter field in the board header searches title, tags and link only (never scope, extras or plan), ignoring case and accents; several words must all match. It narrows the four columns at once; the column counters show what is left. The mini window and the tab title keep counting every card.
