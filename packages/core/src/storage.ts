import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BoardSchema, type Board } from "./model.js";

export function defaultHome(): string {
  return process.env.KANBAN_HOME ?? path.join(os.homedir(), ".kanban");
}

/** Reads and validates the board; returns an empty board if the file does not exist. */
export async function loadBoard(file: string): Promise<Board> {
  try {
    return BoardSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return BoardSchema.parse({});
    throw err;
  }
}

/** Atomic write: write to a temp file in the same dir, then rename over the target. */
export async function saveBoard(file: string, board: Board): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(board, null, 2), "utf8");
  await fs.rename(tmp, file);
}
