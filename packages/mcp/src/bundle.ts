import { promises as fs } from "node:fs";
import path from "node:path";
import { BundleSchema, type Bundle } from "@agent-board/core";

export async function readBundle(file: string): Promise<Bundle> {
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(file), "utf8");
  } catch {
    throw new Error(`Cannot read "${file}"`);
  }
  try {
    return BundleSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(`"${file}" is not a kanban export file`);
  }
}
