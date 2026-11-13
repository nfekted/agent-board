import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defaultHome } from "@agent-board/core";
import { readRunningDaemon, stopDaemon } from "@agent-board/server";

/** Set to true by scripts/bundle.mjs: the daemon then runs from the same single file. */
declare const BUNDLED: boolean | undefined;

export class DaemonRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Thin HTTP client of the kanban daemon; starts the daemon when it is not running. */
export class DaemonClient {
  constructor(readonly home = defaultHome()) {}

  /** Returns the daemon base URL, spawning a detached daemon if needed. */
  async baseUrl(): Promise<string> {
    let info = await readRunningDaemon(this.home);
    if (!info) {
      this.spawnDaemon();
      for (let i = 0; i < 100 && !info; i++) {
        await new Promise((r) => setTimeout(r, 50));
        info = await readRunningDaemon(this.home);
      }
      if (!info) throw new Error("Kanban daemon did not start in time");
    }
    return `http://127.0.0.1:${info.port}`;
  }

  /** Stops the daemon if it is running; does NOT start one first. */
  stop() {
    return stopDaemon(this.home);
  }

  private spawnDaemon(): void {
    const args =
      typeof BUNDLED !== "undefined"
        ? [fileURLToPath(import.meta.url), "daemon"]
        : [createRequire(import.meta.url).resolve("@agent-board/server/dist/bin.js")];
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, KANBAN_HOME: this.home },
    });
    child.unref();
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${await this.baseUrl()}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new DaemonRequestError(data.error ?? `HTTP ${res.status}`, res.status);
    return data as T;
  }
}
