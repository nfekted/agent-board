#!/usr/bin/env node
import { readRunningDaemon, startDaemon, stopDaemon } from "./daemon.js";

if (process.argv[2] === "stop") {
  const result = await stopDaemon();
  console.log(result.stopped ? `Kanban daemon stopped (pid ${result.pid}).` : "No kanban daemon is running.");
  process.exit(0);
}

try {
  const daemon = await startDaemon({
    port: process.env.KANBAN_PORT ? Number(process.env.KANBAN_PORT) : undefined,
  });
  console.log(`Kanban daemon running at http://127.0.0.1:${daemon.port}/ (pid ${process.pid}). Ctrl+C to stop.`);
  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  // Another instance won the race (or is already running): nothing to do.
  const running = await readRunningDaemon();
  console.error(
    running ? `Daemon already running at http://127.0.0.1:${running.port}/ (pid ${running.pid})` : (err as Error).message,
  );
  process.exit(0);
}
