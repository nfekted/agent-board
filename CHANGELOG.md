# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-13

First public release.

### Added
- Local kanban board with five columns: backlog, queue, planning, doing and validation. Cards are ordered by priority inside each column.
- Claude Code plugin: a skill that drives the workflow, slash commands (`/agent-board:kanban`, `new`, `start`, `finish`, `import`, `export`, `stop`) and an MCP server with 12 `kanban_*` tools.
- Planning flow with a plan the user approves before any code is written (or direct execution), a branch per card, a blocked state with a reason, and adjustments during validation.
- Test steps: a short numbered checklist the agent writes before a card goes to validation.
- Web UI served by a local daemon, with live updates, a side panel (expandable to full screen) for card details, drag and drop plus a keyboard-friendly "Move to…" menu, tags, a filter over title, tags and link, and light and dark themes.
- Projects: add by folder path, remove when empty. A project also shows the cards of the folders inside it.
- Mini window (Document Picture-in-Picture) with one counter per state.
- Export and import of cards with their plans (`.kanban.json`), and import from a Markdown notes file (`link:`, `project:`, `tags:` and `status: backlog` lines).
- English and Portuguese (pt-BR) interface.
- Single-file build (`plugin/dist`, created by `npm run bundle`) so the plugin installs without compiling, and a marketplace manifest so the repository can be added with `/plugin marketplace add`.
- CI on GitHub Actions: build and tests on Node 20 and 22, a check that the committed bundle is up to date, and `npm audit` for production dependencies.

### Security
- The daemon listens on `127.0.0.1` only and rejects requests with a foreign `Host` or `Origin` header or a non-JSON content type on writes.
- Data stays in a local folder (`~/.kanban` by default); nothing is sent anywhere.

[1.0.0]: https://github.com/nfekted/agent-board/releases/tag/v1.0.0
