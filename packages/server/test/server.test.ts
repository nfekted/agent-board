import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BoardService, createApp, readRunningDaemon, startDaemon, stopDaemon } from "../src/index.js";

let dir: string;
let service: BoardService;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-srv-"));
  service = new BoardService(path.join(dir, "board.json"));
  app = createApp(service);
});

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("API", () => {
  it("creates, lists, filters by repo and finds by title", async () => {
    await app.request("/api/cards", json({ title: "123", repo: "/a" }));
    await app.request("/api/cards", json({ title: "123", repo: "/b" }));
    expect((await (await app.request("/api/cards")).json()).length).toBe(2);
    const inA = await (await app.request("/api/cards?repo=/a")).json();
    expect(inA).toHaveLength(1);
    const got = await app.request("/api/cards/123?repo=/b");
    expect((await got.json()).repo).toBe("/b");
  });

  it("finds a card by unique id prefix and rejects an ambiguous one", async () => {
    const a = await (await app.request("/api/cards", json({ title: "x", repo: "/a" }))).json();
    expect((await (await app.request(`/api/cards/${a.id.slice(0, 4)}?repo=/a`)).json()).id).toBe(a.id);
    expect((await app.request(`/api/cards/${a.id.slice(0, 2)}?repo=/a`)).status).toBe(404);
  });

  it("rejects duplicate title in the same repo with 409", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    const res = await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    expect(res.status).toBe(409);
  });

  it("validates input and unknown cards", async () => {
    expect((await app.request("/api/cards", json({ repo: "/a" }))).status).toBe(400);
    expect((await app.request("/api/cards/nope")).status).toBe(404);
  });

  it("enforces transitions with 422 and allows planSkipped path", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    const bad = await app.request("/api/cards/1/move", json({ status: "validation" }));
    expect(bad.status).toBe(422);
    const noPlan = await app.request("/api/cards/1/move", json({ status: "doing" }));
    expect(noPlan.status).toBe(422);
    await app.request("/api/cards/1", json({ planSkipped: true }, "PATCH"));
    const ok = await app.request("/api/cards/1/move", json({ status: "doing" }));
    expect((await ok.json()).status).toBe("doing");
  });

  it("deletes a card", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    expect((await app.request("/api/cards/1", { method: "DELETE" })).status).toBe(200);
    expect(await (await app.request("/api/cards")).json()).toEqual([]);
  });

  it("serializes concurrent creates without losing cards", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        app.request("/api/cards", json({ title: String(i), repo: "/a" })),
      ),
    );
    expect(await service.list()).toHaveLength(25);
  });

  it("emits events to subscribers", async () => {
    const seen: string[] = [];
    service.subscribe((e) => seen.push(e.type));
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    await app.request("/api/cards/1", { method: "DELETE" });
    expect(seen).toEqual(["card.created", "card.removed"]);
  });
});

describe("request origin hardening", () => {
  const body = JSON.stringify({ title: "evil", repo: "/a" });

  it("rejects writes that are not application/json (cross-site simple requests)", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await app.request("/api/cards", { method: "POST", headers: { "content-type": type }, body });
      expect(res.status, type).toBe(415);
    }
    expect(await service.list()).toEqual([]);
  });

  it("accepts application/json with a charset", async () => {
    const res = await app.request("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body,
    });
    expect(res.status).toBe(201);
  });

  it("rejects a browser Origin that is not the daemon's own origin, for reads and writes", async () => {
    const headers = { origin: "https://evil.example", "content-type": "application/json" };
    expect((await app.request("/api/cards", { headers })).status).toBe(403);
    expect((await app.request("/api/cards", { method: "POST", headers, body })).status).toBe(403);
    expect((await app.request("/api/cards", { headers: { origin: "null" } })).status).toBe(403);
    expect(await service.list()).toEqual([]);
  });

  it("accepts the UI's own origin and requests without Origin (MCP, curl)", async () => {
    const same = await app.request("http://localhost:4317/api/cards", { headers: { origin: "http://localhost:4317" } });
    expect(same.status).toBe(200);
    expect((await app.request("/api/cards")).status).toBe(200);
  });

  it("rejects non-loopback Host headers (DNS rebinding), including for the UI", async () => {
    const evil = { host: "evil.example:4317", origin: "http://evil.example:4317" };
    expect((await app.request("/api/cards", { headers: evil })).status).toBe(403);
    expect((await app.request("/", { headers: { host: "evil.example" } })).status).toBe(403);
    for (const host of ["127.0.0.1:4317", "localhost:4317", "[::1]:4317"]) {
      expect((await app.request("/api/health", { headers: { host } })).status, host).toBe(200);
    }
  });
});

describe("stopDaemon", () => {
  it("reports that nothing was running", async () => {
    expect(await stopDaemon(dir)).toEqual({ stopped: false });
  });
});

describe("nested projects", () => {
  it("a project includes the folders inside it, but not siblings that share a prefix", async () => {
    for (const repo of ["/p", "/p/front", "/p/api", "/pp"]) {
      await app.request("/api/cards", json({ title: repo.replace(/\W/g, "") || "root", repo }));
    }
    const titles = async (repo: string) =>
      (await (await app.request(`/api/cards?repo=${repo}`)).json()).map((c: { title: string }) => c.title).sort();
    expect(await titles("/p")).toEqual(["p", "papi", "pfront"]);
    expect(await titles("/p/front")).toEqual(["pfront"]);
    expect(await titles("/pp")).toEqual(["pp"]);
  });

  it("in a project, a card of that exact folder wins over a same-titled card in a nested one", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/p/front", scope: "nested" }));
    await app.request("/api/cards", json({ title: "1", repo: "/p", scope: "top" }));
    expect((await (await app.request("/api/cards/1?repo=/p")).json()).scope).toBe("top");
    expect((await (await app.request("/api/cards/1?repo=/p/front")).json()).scope).toBe("nested");
  });

  it("finds a nested card from the parent project, but not from a sibling", async () => {
    await app.request("/api/cards", json({ title: "9", repo: "/p/front" }));
    expect((await app.request("/api/cards/9?repo=/p")).status).toBe(200);
    expect((await app.request("/api/cards/9?repo=/p/api")).status).toBe(404);
  });
});

describe("projects", () => {
  it("lists registered projects and projects that have cards, without duplicates", async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-proj-"));
    const added = await app.request("/api/projects", json({ path: real }));
    expect(added.status).toBe(201);
    await app.request("/api/cards", json({ title: "1", repo: "/only-with-card" }));
    await app.request("/api/projects", json({ path: real }));
    expect(await (await app.request("/api/projects")).json()).toEqual([real, "/only-with-card"].sort());
  });

  it("removes an empty project, but refuses while it has cards (also nested ones)", async () => {
    const real = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-proj-"));
    await app.request("/api/projects", json({ path: real }));
    await app.request("/api/cards", json({ title: "1", repo: path.join(real, "sub") }));
    const refused = await app.request(`/api/projects?path=${encodeURIComponent(real)}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    await app.request("/api/cards/1", { method: "DELETE" });
    const done = await app.request(`/api/projects?path=${encodeURIComponent(real)}`, { method: "DELETE" });
    expect(done.status).toBe(200);
    expect(await done.json()).not.toContain(real);
    expect((await app.request(`/api/projects?path=${encodeURIComponent(real)}`, { method: "DELETE" })).status).toBe(404);
  });

  it("rejects a path that is not an existing directory", async () => {
    expect((await app.request("/api/projects", json({ path: "/does/not/exist" }))).status).toBe(400);
    expect((await app.request("/api/projects", json({}))).status).toBe(400);
  });
});

describe("plan files", () => {
  it("removing a card deletes its plan file from the plans folder, and leaves files elsewhere alone", async () => {
    const plans = path.join(dir, "plans");
    await fs.mkdir(plans);
    const inside = path.join(plans, "a-1.md");
    const outside = path.join(dir, "keep.md");
    await fs.writeFile(inside, "plan");
    await fs.writeFile(outside, "plan");
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    await app.request("/api/cards", json({ title: "2", repo: "/a" }));
    await app.request("/api/cards/1", json({ plan: inside }, "PATCH"));
    await app.request("/api/cards/2", json({ plan: outside }, "PATCH"));
    await app.request("/api/cards/1", { method: "DELETE" });
    await app.request("/api/cards/2", { method: "DELETE" });
    await expect(fs.access(inside)).rejects.toThrow();
    await expect(fs.access(outside)).resolves.toBeUndefined();
  });
});

describe("external link", () => {
  it("accepts http(s), clears with empty string and rejects other schemes with 400", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/a", externalUrl: "https://x.test/1" }));
    expect((await (await app.request("/api/cards/1")).json()).externalUrl).toBe("https://x.test/1");
    expect((await app.request("/api/cards/1", json({ externalUrl: "ftp://x" }, "PATCH"))).status).toBe(400);
    const cleared = await app.request("/api/cards/1", json({ externalUrl: "" }, "PATCH"));
    expect((await cleared.json()).externalUrl).toBeUndefined();
  });

  it("keeps blockReason only while blocked, and clears it when unblocked", async () => {
    await app.request("/api/cards", json({ title: "1", repo: "/a" }));
    const blocked = await (await app.request("/api/cards/1", json({ substatus: "blocked", blockReason: "which rule?" }, "PATCH"))).json();
    expect(blocked.substatus).toBe("blocked");
    expect(blocked.blockReason).toBe("which rule?");
    const resumed = await (await app.request("/api/cards/1", json({ substatus: "working" }, "PATCH"))).json();
    expect(resumed.blockReason).toBeUndefined();
  });
});

describe("static UI", () => {
  it("serves index and assets, falls back to index, blocks traversal", async () => {
    const ui = path.join(dir, "ui");
    await fs.mkdir(path.join(ui, "assets"), { recursive: true });
    await fs.writeFile(path.join(ui, "index.html"), "<h1>board</h1>");
    await fs.writeFile(path.join(ui, "assets", "a.js"), "1");
    await fs.writeFile(path.join(dir, "secret.txt"), "secret");
    const uiApp = createApp(service, { uiDir: ui });
    expect(await (await uiApp.request("/")).text()).toBe("<h1>board</h1>");
    const js = await uiApp.request("/assets/a.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await (await uiApp.request("/some/route")).text()).toBe("<h1>board</h1>");
    expect((await uiApp.request("/assets/missing.js")).status).toBe(404);
    expect((await uiApp.request("/..%2Fsecret.txt")).status).toBe(404);
    expect((await uiApp.request("/api/health")).status).toBe(200);
  });

  it("answers 404 with a hint when the UI is not built", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("UI not available");
  });
});

describe("daemon", () => {
  it("is single-instance and cleans its lock on stop", async () => {
    const d = await startDaemon({ home: dir });
    expect((await readRunningDaemon(dir))?.port).toBe(d.port);
    await expect(startDaemon({ home: dir })).rejects.toThrow(/already running/);
    const res = await fetch(`http://127.0.0.1:${d.port}/api/health`);
    expect((await res.json()).ok).toBe(true);
    await d.stop();
    expect(await readRunningDaemon(dir)).toBeUndefined();
  });

  it("replaces a stale lock file", async () => {
    await fs.writeFile(path.join(dir, "daemon.json"), JSON.stringify({ pid: 999999, port: 1 }));
    const d = await startDaemon({ home: dir });
    expect(d.port).toBeGreaterThan(0);
    await d.stop();
  });

  it("notifies on manual edits of board.json", async () => {
    const d = await startDaemon({ home: dir });
    const seen = new Promise<string>((resolve) => d.service.subscribe((e) => resolve(e.type)));
    await fs.writeFile(path.join(dir, "board.json"), JSON.stringify({ version: 1, cards: [] }));
    expect(await seen).toBe("board.changed");
    await d.stop();
  });
});

describe("export and import", () => {
  it("round-trips several projects, tags cards as imported with their origin, and writes nothing on preview", async () => {
    const b = path.join(dir, "proj-b");
    const target1 = path.join(dir, "mine-1");
    const target2 = path.join(dir, "mine-2");
    await fs.mkdir(target1);
    await fs.mkdir(target2);
    const c1 = await (await app.request("/api/cards", json({ title: "one", scope: "s1", repo: path.join(dir, "proj-a") }))).json();
    await app.request("/api/cards", json({ title: "two", repo: b }));
    await app.request(`/api/cards/${c1.id}/move`, json({ status: "planning" }));

    const bundle = await (await app.request("/api/export", json({ name: "all" }))).json();
    expect(JSON.stringify(bundle)).not.toContain(dir); // names only, never paths
    expect(bundle.cards.map((c: { project: string }) => c.project).sort()).toEqual(["proj-a", "proj-b"]);

    const dirs = { "proj-a": target1, "proj-b": target2 };
    const preview = await (await app.request("/api/import", json({ bundle, dirs }))).json();
    expect(preview.preview).toBe(true);
    expect((await (await app.request("/api/cards?repo=" + target1)).json())).toEqual([]);

    const done = await (await app.request("/api/import", json({ bundle, dirs, confirm: true }))).json();
    expect(done.created.sort()).toEqual(["one", "two"]);
    const [one] = await (await app.request("/api/cards?repo=" + target1)).json();
    expect(one).toMatchObject({ status: "queue", planApproved: false, imported: { status: "planning", planningStep: "scope" } });

    const cleared = await (await app.request(`/api/cards/${one.id}`, json({ imported: false }, "PATCH"))).json();
    expect(cleared.imported).toBeUndefined();
  });

  it("refuses to import into a folder that does not exist, and exports only the chosen ids", async () => {
    const repo = path.join(dir, "r");
    await fs.mkdir(repo);
    const x = await (await app.request("/api/cards", json({ title: "x", repo }))).json();
    await app.request("/api/cards", json({ title: "y", repo }));
    const bundle = await (await app.request("/api/export", json({ name: "n", ids: [x.id] }))).json();
    expect(bundle.cards).toHaveLength(1);
    const bad = await app.request("/api/import", json({ bundle, dirs: { r: path.join(dir, "nope") }, confirm: true }));
    expect(bad.status).toBe(400);
    expect((await app.request("/api/export", json({ name: "n", ids: ["zzzz"] }))).status).toBe(404);
  });
});

describe("tags", () => {
  it("normalizes tags on create and update, and carries them through export and import", async () => {
    const repo = path.join(dir, "t");
    const target = path.join(dir, "t2");
    await fs.mkdir(repo);
    await fs.mkdir(target);
    const card = await (await app.request("/api/cards", json({ title: "c", repo, tags: [" Front ", "front", "", "urgente"] }))).json();
    expect(card.tags).toEqual(["Front", "urgente"]);
    expect((await (await app.request(`/api/cards/${card.id}`, json({ tags: [] }, "PATCH"))).json()).tags).toEqual([]);
    await app.request(`/api/cards/${card.id}`, json({ tags: ["a", "B"] }, "PATCH"));
    const bundle = await (await app.request("/api/export", json({ name: "n" }))).json();
    await app.request("/api/import", json({ bundle, dirs: { t: target }, confirm: true }));
    const [copy] = await (await app.request("/api/cards?repo=" + target)).json();
    expect(copy.tags).toEqual(["a", "B"]);
  });
});

describe("backlog", () => {
  it("creates parked cards, which can only come back through the queue", async () => {
    const repo = path.join(dir, "bk");
    const card = await (await app.request("/api/cards", json({ title: "debt", repo, status: "backlog" }))).json();
    expect(card.status).toBe("backlog");
    expect((await app.request(`/api/cards/${card.id}/move`, json({ status: "planning" }))).status).toBe(422);
    expect((await (await app.request(`/api/cards/${card.id}/move`, json({ status: "queue" }))).json()).status).toBe("queue");
    expect((await (await app.request(`/api/cards/${card.id}/move`, json({ status: "backlog" }))).json()).status).toBe("backlog");
  });
});

describe("ordering", () => {
  it("reorders inside a column, drops at a given place, and keeps the order across columns", async () => {
    const repo = path.join(dir, "o");
    const ids: string[] = [];
    for (const title of ["1", "2", "3"]) ids.push((await (await app.request("/api/cards", json({ title, repo }))).json()).id);
    const order = async (status?: string) =>
      (await (await app.request("/api/cards?repo=" + repo)).json()).filter((c: { status: string }) => !status || c.status === status).map((c: { title: string }) => c.title);
    expect(await order()).toEqual(["1", "2", "3"]);
    await app.request(`/api/cards/${ids[2]}/reorder`, json({ before: ids[0] }));
    expect(await order()).toEqual(["3", "1", "2"]);
    await app.request(`/api/cards/${ids[2]}/reorder`, json({ before: null }));
    expect(await order()).toEqual(["1", "2", "3"]);
    // moving to another column at a given place
    await app.request(`/api/cards/${ids[0]}/move`, json({ status: "planning" }));
    await app.request(`/api/cards/${ids[1]}/move`, json({ status: "planning", before: ids[0] }));
    expect(await order("planning")).toEqual(["2", "1"]);
    // the target must be in the same column
    expect((await app.request(`/api/cards/${ids[2]}/reorder`, json({ before: ids[0] }))).status).toBe(404);
  });
});

describe("test steps", () => {
  it("stores the steps on the card and clears them with an empty string", async () => {
    const card = await (await app.request("/api/cards", json({ title: "ts", repo: path.join(dir, "ts") }))).json();
    expect(card.testSteps).toBeUndefined();
    const steps = '1. Screen "Students": fill the Name field.\n2. Leave the field: it must turn gray.';
    expect((await (await app.request(`/api/cards/${card.id}`, json({ testSteps: steps }, "PATCH"))).json()).testSteps).toBe(steps);
    expect((await (await app.request(`/api/cards/${card.id}`, json({ title: "ts2" }, "PATCH"))).json()).testSteps).toBe(steps);
    expect((await (await app.request(`/api/cards/${card.id}`, json({ testSteps: "" }, "PATCH"))).json()).testSteps).toBeUndefined();
  });
});

