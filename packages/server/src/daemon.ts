import { promises as fs, watch } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { defaultHome } from "@kanban-mcp/core";
import { createApp } from "./app.js";
import { BoardService } from "./service.js";
import { resolveUiDir } from "./static.js";

export interface DaemonInfo {
  pid: number;
  port: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Returns info of a running daemon, or undefined (cleaning up a stale lock file). */
export async function readRunningDaemon(home = defaultHome()): Promise<DaemonInfo | undefined> {
  const lock = path.join(home, "daemon.json");
  try {
    const info = JSON.parse(await fs.readFile(lock, "utf8")) as DaemonInfo;
    if (isAlive(info.pid)) return info;
    await fs.rm(lock, { force: true });
  } catch {
    /* no lock file */
  }
  return undefined;
}

/**
 * Asks the running daemon (if any) to shut down with SIGTERM and waits until it is gone.
 * Never call it from the daemon's own process.
 */
export async function stopDaemon(
  home = defaultHome(),
  timeoutMs = 5000,
): Promise<{ stopped: false } | { stopped: true; pid: number }> {
  const info = await readRunningDaemon(home);
  if (!info) return { stopped: false };
  process.kill(info.pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await readRunningDaemon(home))) return { stopped: true, pid: info.pid };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Daemon (pid ${info.pid}) did not stop within ${timeoutMs}ms`);
}

export interface StartOptions {
  home?: string;
  port?: number;
  uiDir?: string;
}

export async function startDaemon(opts: StartOptions = {}) {
  const home = opts.home ?? defaultHome();
  const existing = await readRunningDaemon(home);
  if (existing) throw new Error(`Daemon already running (pid ${existing.pid}, port ${existing.port})`);

  await fs.mkdir(home, { recursive: true });
  const boardFile = path.join(home, "board.json");
  const service = new BoardService(boardFile);
  const app = createApp(service, { uiDir: opts.uiDir ?? resolveUiDir() });

  const server = serve({ fetch: app.fetch, port: opts.port ?? 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const lock = path.join(home, "daemon.json");
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid, port } satisfies DaemonInfo), {
    flag: "wx",
  });

  // Pick up manual edits of board.json and tell connected UIs to refetch.
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(home, (_event, filename) => {
    if (filename !== "board.json") return;
    clearTimeout(timer);
    timer = setTimeout(() => service.emit({ type: "board.changed" }), 100);
  });

  return {
    port,
    service,
    async stop() {
      clearTimeout(timer);
      watcher.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(lock, { force: true });
    },
  };
}
