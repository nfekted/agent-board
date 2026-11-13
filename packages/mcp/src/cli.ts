#!/usr/bin/env node
// Entry of the single-file build (plugin/dist/agent-board.mjs):
//   (no args)  MCP server on stdio;  daemon  runs the daemon;  stop  stops it.
const mode = process.argv[2];
if (mode === "daemon" || mode === "stop") await import("@agent-board/server/dist/bin.js");
else await import("./bin.js");
