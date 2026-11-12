import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readRunningDaemon, startDaemon } from "@agent-board/server";
import { DaemonClient } from "../src/daemon-client.js";
import { createMcpServer } from "../src/tools.js";
import { resolveProject } from "../src/repo.js";

let home: string;
let repoA: string;
let repoB: string;
let daemon: Awaited<ReturnType<typeof startDaemon>>;

async function makeRepo(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `kanban-${name}-`));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return await fs.realpath(dir);
}

async function clientFor(cwd: string, opened: string[] = []) {
  const server = createMcpServer({
    daemon: new DaemonClient(home),
    getCwd: () => cwd,
    openUrl: (u) => opened.push(u),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    const body = res.content[0]!.text;
    return { isError: !!res.isError, body, json: () => JSON.parse(body) };
  };
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-home-"));
  repoA = await makeRepo("a");
  repoB = await makeRepo("b");
  daemon = await startDaemon({ home });
});
afterEach(async () => {
  await daemon.stop();
});

describe("kanban MCP tools", () => {
  it("exposes the expected tools", async () => {
    const server = createMcpServer({ daemon: new DaemonClient(home), getCwd: () => repoA });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "kanban_branch_name",
        "kanban_create",
        "kanban_export",
        "kanban_finish",
        "kanban_get",
        "kanban_import_bundle",
        "kanban_list",
        "kanban_move",
        "kanban_open",
        "kanban_project_info",
        "kanban_stop",
        "kanban_update",
      ],
    );
  });

  it("derives the branch name from the card title", async () => {
    const a = await clientFor(repoA);
    await a("kanban_create", { title: "tarefa 123" });
    expect((await a("kanban_branch_name", { card: "tarefa 123" })).json().branch).toBe("tarefa_123");
  });

  it("creates a card tied to the cwd git root and lists only that repo", async () => {
    const a = await clientFor(repoA);
    const b = await clientFor(repoB);
    const created = (await a("kanban_create", { title: "123", scope: "do it" })).json();
    expect(created.repo).toBe(repoA);
    await b("kanban_create", { title: "999" });
    expect((await a("kanban_list")).json().map((c: { title: string }) => c.title)).toEqual(["123"]);
    expect((await a("kanban_list", { all: true })).json()).toHaveLength(2);
  });

  it("works from a subfolder of the repo", async () => {
    const sub = path.join(repoA, "src", "deep");
    await fs.mkdir(sub, { recursive: true });
    const inSub = await clientFor(sub);
    const created = (await inSub("kanban_create", { title: "7" })).json();
    expect(created.repo).toBe(repoA);
  });

  it("refuses to act on a card from another repository", async () => {
    const a = await clientFor(repoA);
    const b = await clientFor(repoB);
    await a("kanban_create", { title: "123" });
    const res = await b("kanban_get", { card: "123" });
    expect(res.isError).toBe(true);
    expect(res.body).toContain("belongs to another project");
    expect((await b("kanban_finish", { card: "123" })).isError).toBe(true);
    expect((await a("kanban_list")).json()).toHaveLength(1);
  });

  it("treats a plain folder as the project when there is no git repository", async () => {
    const plain = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-nogit-")));
    const call = await clientFor(plain);
    const created = await call("kanban_create", { title: "1" });
    expect(created.isError).toBe(false);
    expect(created.json().repo).toBe(plain);
    expect((await call("kanban_list")).json()).toHaveLength(1);
  });

  it("project_info lists child repositories of a plain folder", async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-multi-")));
    for (const name of ["front", "api"]) {
      await fs.mkdir(path.join(parent, name));
      execFileSync("git", ["init", "-q"], { cwd: path.join(parent, name) });
    }
    await fs.mkdir(path.join(parent, "docs"));
    const info = (await (await clientFor(parent))("kanban_project_info")).json();
    expect(info).toMatchObject({ root: parent, isGit: false, childRepos: ["api", "front"] });
    const inRepo = (await (await clientFor(repoA))("kanban_project_info")).json();
    expect(inRepo).toMatchObject({ root: repoA, isGit: true, childRepos: [] });
  });

  it("registers the project so it is listed even without cards", async () => {
    await (await clientFor(repoA))("kanban_list");
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/projects`);
    expect(await res.json()).toContain(repoA);
  });

  it("stores and clears the external link, rejecting non-http schemes", async () => {
    const a = await clientFor(repoA);
    const created = (await a("kanban_create", { title: "1", externalUrl: "https://k.example.com/1" })).json();
    expect(created.externalUrl).toBe("https://k.example.com/1");
    expect((await a("kanban_update", { card: "1", externalUrl: "javascript:alert(1)" })).isError).toBe(true);
    expect((await a("kanban_update", { card: "1", externalUrl: "" })).json().externalUrl).toBeUndefined();
  });

  it("finish opens the external link only when asked, after removing the card", async () => {
    const opened: string[] = [];
    const a = await clientFor(repoA, opened);
    await a("kanban_create", { title: "1", externalUrl: "https://k.example.com/1" });
    await a("kanban_create", { title: "2", externalUrl: "https://k.example.com/2" });
    await a("kanban_create", { title: "3" });
    expect((await a("kanban_finish", { card: "1" })).json().opened).toBe(false);
    expect((await a("kanban_finish", { card: "2", openExternal: true })).json().opened).toBe(true);
    const noLink = (await a("kanban_finish", { card: "3", openExternal: true })).json();
    expect(noLink.opened).toBe(false);
    expect(noLink.note).toContain("no external link");
    expect(opened).toEqual(["https://k.example.com/2"]);
    expect((await a("kanban_list")).json()).toEqual([]);
  });

  it("runs the full lifecycle with transition guards", async () => {
    const a = await clientFor(repoA);
    await a("kanban_create", { title: "tarefa 123", scope: "x" });
    expect((await a("kanban_move", { card: "tarefa 123", status: "doing" })).isError).toBe(true);
    expect((await a("kanban_move", { card: "tarefa 123", status: "planning" })).json().planningStep).toBe("scope");
    await a("kanban_update", { card: "tarefa 123", planApproved: true, branch: "tarefa_123" });
    expect((await a("kanban_move", { card: "tarefa 123", status: "doing" })).json().status).toBe("doing");
    expect((await a("kanban_move", { card: "tarefa 123", status: "validation" })).json().substatus).toBe("waiting-user");
    expect((await a("kanban_move", { card: "tarefa 123", status: "doing" })).json().status).toBe("doing");
    await a("kanban_finish", { card: "tarefa 123" });
    expect((await a("kanban_list")).json()).toEqual([]);
  });

  it("kanban_open returns the daemon URL and opens it", async () => {
    const opened: string[] = [];
    const a = await clientFor(repoA, opened);
    const { url } = (await a("kanban_open")).json();
    expect(url).toBe(`http://127.0.0.1:${daemon.port}/?repo=${encodeURIComponent(repoA)}`);
    expect(opened).toEqual([url]);
  });
});

describe("nested folders share one project", () => {
  async function multiRepo() {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-parent-")));
    const front = path.join(parent, "front");
    await fs.mkdir(front);
    execFileSync("git", ["init", "-q"], { cwd: front });
    return { parent, front };
  }

  it("a repo inside a known plain-folder project uses the parent's board", async () => {
    const { parent, front } = await multiRepo();
    const atParent = await clientFor(parent);
    const atFront = await clientFor(front);
    await atParent("kanban_create", { title: "1" });
    expect((await atFront("kanban_list")).json().map((c: { title: string }) => c.title)).toEqual(["1"]);
    expect((await atFront("kanban_create", { title: "2" })).json().repo).toBe(parent);
    expect((await atParent("kanban_list")).json()).toHaveLength(2);
    expect((await atFront("kanban_project_info")).json()).toMatchObject({
      root: parent,
      isGit: false,
      openedIn: front,
      cwdRepo: front,
      childRepos: ["front"],
    });
  });

  it("stays separate while the parent is not a known project", async () => {
    const { parent, front } = await multiRepo();
    expect((await (await clientFor(front))("kanban_create", { title: "1" })).json().repo).toBe(front);
    // once the parent is used, it sees the card that was created in front
    const atParent = await clientFor(parent);
    expect((await atParent("kanban_list")).json()).toHaveLength(1);
  });

  it("does not fold into a git repository, the home folder or the filesystem root", async () => {
    const { parent, front } = await multiRepo();
    expect((await resolveProject(front, [parent])).root).toBe(parent);
    expect((await resolveProject(front, [parent], [parent])).root).toBe(front); // blocked (e.g. home)
    expect((await resolveProject(front, ["/"])).root).toBe(front); // filesystem root
    execFileSync("git", ["init", "-q"], { cwd: parent });
    expect((await resolveProject(front, [parent])).root).toBe(front); // parent is a git repo
  });
});

describe("kanban_stop", () => {
  it("stops a daemon that runs in its own process and lets the next call restart it", async () => {
    const home2 = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-stop-"));
    const client = new DaemonClient(home2);
    const server = createMcpServer({ daemon: client, getCwd: () => repoA });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const mcp = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), mcp.connect(b)]);
    const call = async (name: string) =>
      JSON.parse(((await mcp.callTool({ name, arguments: {} })) as { content: { text: string }[] }).content[0]!.text);

    expect(await call("kanban_stop")).toMatchObject({ stopped: false }); // nothing to stop, and it must not start one
    expect(await readRunningDaemon(home2)).toBeUndefined();

    await client.baseUrl(); // spawns a detached daemon
    const first = await readRunningDaemon(home2);
    expect(first).toBeDefined();

    expect(await call("kanban_stop")).toEqual({ stopped: true, pid: first!.pid });
    expect(await readRunningDaemon(home2)).toBeUndefined();

    await call("kanban_list"); // any kanban tool starts it again
    const second = await readRunningDaemon(home2);
    expect(second?.pid).not.toBe(first!.pid);
    await client.stop();
  }, 30000);
});

describe("export and import of cards", () => {
  it("round-trips scope, extras, link and plan between two projects; queue only, nothing approved", async () => {
    const a = await clientFor(repoA);
    const b = await clientFor(repoB);
    await a("kanban_create", { title: "tarefa 1", scope: "do X\nmore", externalUrl: "https://t.example/1" });
    await a("kanban_create", { title: "2", scope: "other" });
    const planFile = path.join(home, "plan-src.md");
    await fs.writeFile(planFile, "# plan\n- step");
    await a("kanban_update", { card: "tarefa 1", extras: "see src/a.ts", plan: planFile, planApproved: true, branch: "tarefa_1" });

    const exp = (await a("kanban_export", { name: "cards extras" })).json();
    expect(exp.file).toBe(path.join(repoA, "cards_extras.kanban.json"));
    expect(exp).toMatchObject({ exported: ["tarefa 1", "2"], withPlan: 1 });
    const raw = await fs.readFile(exp.file, "utf8");
    expect(raw).not.toContain("tarefa_1"); // branch stays local
    expect(raw).not.toContain(repoA);

    const preview = (await b("kanban_import_bundle", { path: exp.file })).json();
    expect(preview).toMatchObject({ preview: true, name: "cards extras" });
    expect(preview.cards.map((c: { title: string }) => c.title)).toEqual(["tarefa 1", "2"]);
    expect((await b("kanban_list")).json()).toEqual([]); // preview creates nothing

    const done = (await b("kanban_import_bundle", { path: exp.file, confirm: true })).json();
    expect(done.created).toEqual(["tarefa 1", "2"]);
    const card = (await b("kanban_get", { card: "tarefa 1" })).json();
    expect(card).toMatchObject({ status: "queue", scope: "do X\nmore", extras: "see src/a.ts", externalUrl: "https://t.example/1", planApproved: false, repo: repoB });
    expect(card.branch).toBeUndefined();
    expect(card.plan).toContain(path.join(home, "plans"));
    expect(await fs.readFile(card.plan, "utf8")).toBe("# plan\n- step");
  });

  it("tags imported cards with where they were, and can send them to another folder", async () => {
    const a = await clientFor(repoA);
    await a("kanban_create", { title: "t1", scope: "s" });
    await a("kanban_update", { card: "t1", planSkipped: true });
    await a("kanban_move", { card: "t1", status: "doing" });
    const exp = (await a("kanban_export", { name: "from" })).json();
    const preview = (await a("kanban_import_bundle", { path: exp.file, directory: repoB })).json();
    expect(preview.cards[0]).toMatchObject({ duplicate: false, from: { status: "doing" } });
    await a("kanban_import_bundle", { path: exp.file, directory: repoB, confirm: true });
    const b = await clientFor(repoB);
    const card = (await b("kanban_get", { card: "t1" })).json();
    expect(card).toMatchObject({ status: "queue", repo: repoB, imported: { status: "doing" } });
    await b("kanban_update", { card: "t1", imported: false });
    expect((await b("kanban_get", { card: "t1" })).json().imported).toBeUndefined();
  });

  it("creates a card in another existing folder, and refuses a missing one", async () => {
    const a = await clientFor(repoA);
    const card = (await a("kanban_create", { title: "elsewhere", directory: repoB })).json();
    expect(card.repo).toBe(repoB);
    expect((await a("kanban_list")).json()).toEqual([]);
    expect((await a("kanban_create", { title: "x", directory: path.join(repoA, "nope") })).isError).toBe(true);
  });

  it("creates cards in the backlog, which cannot be started directly", async () => {
    const a = await clientFor(repoA);
    const card = (await a("kanban_create", { title: "debt", backlog: true })).json();
    expect(card.status).toBe("backlog");
    expect((await a("kanban_move", { card: "debt", status: "planning" })).isError).toBe(true);
    expect((await a("kanban_move", { card: "debt", status: "queue" })).json().status).toBe("queue");
  });

  it("exports only the chosen cards, to a given folder", async () => {
    const a = await clientFor(repoA);
    await a("kanban_create", { title: "1" });
    await a("kanban_create", { title: "2" });
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-out-"));
    const exp = (await a("kanban_export", { name: "x", cards: ["2"], path: out })).json();
    expect(exp.file).toBe(path.join(out, "x.kanban.json"));
    expect(exp.exported).toEqual(["2"]);
    expect((await a("kanban_export", { name: "x", cards: ["nope"] })).isError).toBe(true);
  });

  it("handles duplicates with skip or rename, and rejects files that are not exports", async () => {
    const a = await clientFor(repoA);
    await a("kanban_create", { title: "1", scope: "s" });
    const exp = (await a("kanban_export", { name: "dup" })).json();
    expect((await a("kanban_import_bundle", { path: exp.file })).json().cards[0].duplicate).toBe(true);
    expect((await a("kanban_import_bundle", { path: exp.file, confirm: true })).json()).toMatchObject({ created: [], skipped: ["1"] });
    expect((await a("kanban_import_bundle", { path: exp.file, confirm: true, onDuplicate: "rename" })).json().created).toEqual(["1 (2)"]);
    const bad = path.join(repoA, "notes.json");
    await fs.writeFile(bad, '{"hello":1}');
    expect((await a("kanban_import_bundle", { path: bad })).isError).toBe(true);
    expect((await a("kanban_import_bundle", { path: "missing.json" })).isError).toBe(true);
  });

  it("drops non-http links instead of importing them", async () => {
    const a = await clientFor(repoA);
    const file = path.join(repoA, "x.kanban.json");
    await fs.writeFile(file, JSON.stringify({ kanbanBundle: 1, name: "x", exportedAt: "now", cards: [{ title: "9", externalUrl: "javascript:alert(1)" }] }));
    const done = (await a("kanban_import_bundle", { path: file, confirm: true })).json();
    expect(done).toMatchObject({ created: ["9"], droppedLinks: ["9"] });
    expect((await a("kanban_get", { card: "9" })).json().externalUrl).toBeUndefined();
  });
});

describe("DaemonClient", () => {
  it("starts the daemon on demand when none is running", async () => {
    await daemon.stop();
    expect(await readRunningDaemon(home)).toBeUndefined();
    const client = new DaemonClient(home);
    const url = await client.baseUrl();
    const info = await readRunningDaemon(home);
    expect(url).toBe(`http://127.0.0.1:${info!.port}`);
    expect((await client.request<{ ok: boolean }>("GET", "/api/health")).ok).toBe(true);
    process.kill(info!.pid, "SIGTERM");
    while (await readRunningDaemon(home)) await new Promise((r) => setTimeout(r, 50));
    daemon = await startDaemon({ home }); // so afterEach has something to stop
  });
});
