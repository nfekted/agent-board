import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Context } from "hono";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

/** Location of the built UI (packages/ui/dist), or undefined when it has not been built. */
export function resolveUiDir(): string | undefined {
  try {
    const pkg = createRequire(import.meta.url).resolve("@agent-board/ui/package.json");
    return path.join(path.dirname(pkg), "dist");
  } catch {
    return undefined;
  }
}

/** Serves files from `uiDir`; "/" and unknown extension-less paths fall back to index.html. */
export function staticHandler(uiDir: string | undefined) {
  return async (c: Context) => {
    if (!uiDir) return c.text("UI not available: run `npm run build` in packages/ui.", 404);
    const requested = decodeURIComponent(new URL(c.req.url).pathname);
    const rel = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    const file = path.resolve(uiDir, rel);
    if (file !== uiDir && !file.startsWith(uiDir + path.sep)) return c.text("Not found", 404);
    for (const candidate of [file, path.extname(rel) ? undefined : path.join(uiDir, "index.html")]) {
      if (!candidate) continue;
      try {
        const body = await fs.readFile(candidate);
        return new Response(body, {
          headers: { "content-type": MIME[path.extname(candidate)] ?? "application/octet-stream" },
        });
      } catch {
        /* try next candidate */
      }
    }
    return c.text("Not found", 404);
  };
}
