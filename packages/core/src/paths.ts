import path from "node:path";

/** True when `child` is `parent` itself or a folder inside it (no false match on "/a" vs "/ab"). */
export function isWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}
