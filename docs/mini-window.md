# Mini window

The board has a **Mini window** button: a small always-on-top window with the project picker, one counter per flag
(queue, planning, doing, blocked, validation) and a link that opens the full board. It turns red when a card is blocked
and amber when something is in validation.

It uses the browser's Document Picture-in-Picture API (`window.documentPictureInPicture`).

## Limitations

- **Browsers:** only Chromium-based ones with that API (Chrome, Edge, Brave). Firefox and Safari do not have it; the button
  then shows a message instead of opening the window.
- **Needs the board tab:** the window is driven by the open board page. Closing that tab closes the mini window, and it does
  not reopen by itself; opening it always takes a click.
- **Always on top is up to the OS/window manager:** expected on Windows, macOS and Linux with X11. Not guaranteed on Linux
  with Wayland, over full-screen apps on macOS, or across virtual desktops/Spaces.
