#!/usr/bin/env node
import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DaemonClient } from "./daemon-client.js";
import { createMcpServer } from "./tools.js";

function openUrl(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(cmd, [url], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
  child.on("error", () => undefined);
  child.unref();
}

const server = createMcpServer({ daemon: new DaemonClient(), getCwd: () => process.env.CLAUDE_PROJECT_DIR || process.cwd(), openUrl });
await server.connect(new StdioServerTransport());
