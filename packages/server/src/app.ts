import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { BundleSchema, StatusSchema, TransitionError } from "@kanban-mcp/core";
import { ConflictError, InvalidProjectError, NotFoundError, type BoardService } from "./service.js";
import { staticHandler } from "./static.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface AppOptions {
  /** Directory with the built UI; "/" and other non-API GETs are served from it. */
  uiDir?: string;
}

export function createApp(service: BoardService, opts: AppOptions = {}): Hono {
  const app = new Hono();

  // The daemon has no login and listens on loopback, so any web page open in the user's
  // browser could try to talk to it. Defenses:
  //  - Host must be a loopback name (blocks DNS rebinding);
  //  - a browser-supplied Origin must be this same origin (blocks cross-site requests);
  //  - writes must be application/json (a cross-site form/text POST cannot send that without preflight).
  app.use("*", async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ""))) return c.json({ error: "forbidden host" }, 403);
    if (c.req.path.startsWith("/api/")) {
      const origin = c.req.header("origin");
      if (origin !== undefined) {
        let originHost: string | undefined;
        try {
          originHost = new URL(origin).host;
        } catch {
          /* "null" or malformed origin */
        }
        if (originHost !== host) return c.json({ error: "forbidden origin" }, 403);
      }
      if (
        ["POST", "PATCH", "PUT"].includes(c.req.method) &&
        !/^application\/json(\s*;|$)/i.test(c.req.header("content-type") ?? "")
      ) {
        return c.json({ error: "content-type must be application/json" }, 415);
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
    if (err instanceof TransitionError) return c.json({ error: err.message }, 422);
    if (err instanceof SyntaxError || err instanceof InvalidProjectError || err.name === "ZodError") {
      return c.json({ error: err.message }, 400);
    }
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/projects", async (c) => c.json(await service.listProjects()));

  app.post("/api/projects", async (c) => {
    const body = await c.req.json();
    if (typeof body?.path !== "string" || !body.path.trim()) {
      return c.json({ error: "path is required" }, 400);
    }
    return c.json(await service.addProject(body.path.trim()), 201);
  });

  app.delete("/api/projects", async (c) => {
    const dir = c.req.query("path");
    if (!dir?.trim()) return c.json({ error: "path is required" }, 400);
    return c.json(await service.removeProject(dir.trim()));
  });

  app.get("/api/cards", async (c) => c.json(await service.list(c.req.query("repo"))));

  app.get("/api/cards/:id", async (c) =>
    c.json(await service.get(c.req.param("id"), c.req.query("repo"))),
  );

  app.post("/api/cards", async (c) => {
    const body = await c.req.json();
    if (typeof body?.title !== "string" || !body.title.trim() || typeof body?.repo !== "string") {
      return c.json({ error: "title and repo are required" }, 400);
    }
    return c.json(await service.create(body), 201);
  });

  app.patch("/api/cards/:id", async (c) =>
    c.json(await service.update(c.req.param("id"), await c.req.json(), c.req.query("repo"))),
  );

  app.post("/api/cards/:id/move", async (c) => {
    const { status, before } = await c.req.json();
    const parsed = StatusSchema.safeParse(status);
    if (!parsed.success) return c.json({ error: "invalid status" }, 400);
    if (before !== undefined && before !== null && typeof before !== "string") return c.json({ error: "before must be a card id or null" }, 400);
    return c.json(await service.move(c.req.param("id"), parsed.data, c.req.query("repo"), before));
  });

  app.post("/api/cards/:id/reorder", async (c) => {
    const { before } = await c.req.json();
    if (before !== null && typeof before !== "string") return c.json({ error: "before must be a card id or null" }, 400);
    return c.json(await service.reorder(c.req.param("id"), before, c.req.query("repo")));
  });

  app.delete("/api/cards/:id", async (c) =>
    c.json(await service.remove(c.req.param("id"), c.req.query("repo"))),
  );

  app.post("/api/export", async (c) => {
    const { name, ids } = await c.req.json();
    if (typeof name !== "string" || !name.trim()) return c.json({ error: "name is required" }, 400);
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((i) => typeof i === "string"))) {
      return c.json({ error: "ids must be a list of card ids" }, 400);
    }
    return c.json(await service.exportBundle(name.trim(), ids));
  });

  app.post("/api/import", async (c) => {
    const body = await c.req.json();
    const bundle = BundleSchema.safeParse(body?.bundle);
    if (!bundle.success) return c.json({ error: "not a kanban export file" }, 400);
    const dirs = body.dirs && typeof body.dirs === "object" ? (body.dirs as Record<string, string>) : {};
    const onDuplicate = body.onDuplicate === "rename" ? "rename" : "skip";
    return c.json(await service.importBundle(bundle.data, dirs, { confirm: body.confirm === true, onDuplicate }));
  });

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = service.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: "hello", data: "{}" });
      while (!stream.aborted) await stream.sleep(15000);
      unsubscribe();
    }),
  );

  app.get("*", staticHandler(opts.uiDir));

  return app;
}
