import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { branchNameFromTitle, slug, StatusSchema, type Bundle, type Card } from "@kanban-mcp/core";
import { readBundle } from "./bundle.js";
import { DaemonClient, DaemonRequestError } from "./daemon-client.js";
import { findChildRepos, resolveProject, type ResolvedProject } from "./repo.js";

export interface McpDeps {
  daemon: DaemonClient;
  /** Directory the session runs in (the project folder). */
  getCwd: () => string;
  openUrl?: (url: string) => void;
}

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "kanban", version: "0.0.1" });
  const q = (project: string) => `repo=${encodeURIComponent(project)}`;
  const registered = new Set<string>();

  /** The project of this session; also registers it so the UI lists it even without cards. */
  async function currentProject(): Promise<ResolvedProject> {
    const known = await deps.daemon.request<string[]>("GET", "/api/projects").catch(() => [] as string[]);
    const project = await resolveProject(deps.getCwd(), known);
    if (!registered.has(project.root)) {
      registered.add(project.root);
      await deps.daemon.request("POST", "/api/projects", { path: project.root }).catch(() => undefined);
    }
    return project;
  }

  /**
   * Runs `fn` scoped to the current project. If the card is not in this project but exists
   * in another one, refuses with a clear message instead of acting on it.
   */
  async function inProject<T>(idOrTitle: string, fn: (project: string) => Promise<T>) {
    const project = await currentProject();
    try {
      return text(await fn(project.root));
    } catch (err) {
      if (err instanceof DaemonRequestError && err.status === 404) {
        const others = await deps.daemon.request<Card[]>("GET", "/api/cards");
        const elsewhere = others.find((c) => c.id === idOrTitle || c.title === idOrTitle || (idOrTitle.length >= 3 && c.id.startsWith(idOrTitle)));
        if (elsewhere) {
          return fail(
            `Card "${idOrTitle}" belongs to another project (${elsewhere.repo}), not ${project.root}. ` +
              `Open Claude in that folder to work on it.`,
          );
        }
      }
      return fail((err as Error).message);
    }
  }

  const cardPath = (card: string, project: string) => `/api/cards/${encodeURIComponent(card)}?${q(project)}`;
  const externalUrl = z.string().describe("Link to the card in an external tracker (http/https). Empty string clears it.");

  server.tool(
    "kanban_project_info",
    "Describe the current project: its root, whether it is a git repository, the folder Claude was opened in (openedIn) and its git repo (cwdRepo), and, when the project is a plain folder, which immediate subfolders are git repositories.",
    {},
    async () => {
      const project = await currentProject();
      return text({
        root: project.root,
        isGit: project.isGit,
        openedIn: project.openedIn,
        cwdRepo: project.cwdRepo,
        origin: project.origin,
        childRepos: project.isGit ? [] : await findChildRepos(project.root),
      });
    },
  );

  server.tool(
    "kanban_list",
    "List kanban cards. By default only cards of the current project; set all=true for every project.",
    { all: z.boolean().optional(), status: StatusSchema.optional() },
    async ({ all, status }) => {
      const project = await currentProject();
      try {
        const cards = await deps.daemon.request<Card[]>(
          "GET",
          all ? "/api/cards" : `/api/cards?${q(project.root)}`,
        );
        return text(status ? cards.filter((c) => c.status === status) : cards);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.tool(
    "kanban_get",
    "Get one card of the current project by id or title.",
    { card: z.string() },
    ({ card }) => inProject(card, (project) => deps.daemon.request("GET", cardPath(card, project))),
  );

  server.tool(
    "kanban_create",
    "Create a card in the queue (or the backlog) for the current project, or for another existing folder given in `directory` (that folder becomes a project of its own). The title must be unique in the project.",
    {
      title: z.string().min(1),
      scope: z.string().optional(),
      externalUrl: externalUrl.optional(),
      tags: z.array(z.string()).optional().describe("User labels shown as badges"),
      backlog: z.boolean().optional().describe("Create the card parked in the backlog instead of the queue"),
      directory: z.string().optional().describe("Existing folder (absolute, ~ or relative to the folder Claude is open in); default: the current project"),
    },
    async ({ title, scope, externalUrl, tags, backlog, directory }) => {
      const project = await currentProject();
      try {
        const repo = directory
          ? path.resolve(deps.getCwd(), directory.replace(/^~(?=$|[\\/])/, os.homedir()))
          : project.root;
        if (directory && !(await fs.stat(repo).then((s) => s.isDirectory(), () => false))) {
          return fail(`Folder "${repo}" does not exist`);
        }
        return text(
          await deps.daemon.request("POST", "/api/cards", {
            title,
            scope,
            externalUrl,
            tags,
            status: backlog ? "backlog" : undefined,
            repo,
            origin: repo === project.root ? project.origin : undefined,
          }),
        );
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.tool(
    "kanban_update",
    "Update card fields (scope, extras, plan path, planning step, approval flags, branch, external link, ...).",
    {
      card: z.string(),
      title: z.string().optional(),
      scope: z.string().optional(),
      originalScope: z.string().optional(),
      extras: z.string().optional(),
      substatus: z.enum(["waiting-user", "working", "blocked"]).optional(),
      blockReason: z.string().optional().describe("With substatus 'blocked': the question or problem the user must answer"),
      planningStep: z.enum(["scope", "extras", "mode", "plan", "awaiting-approval"]).optional(),
      plan: z.string().optional(),
      planApproved: z.boolean().optional(),
      planSkipped: z.boolean().optional(),
      branch: z.string().optional(),
      externalUrl: externalUrl.optional(),
      testSteps: z.string().optional().describe("Numbered test steps for the card (see the skill, \"Doing -> Validation\"). Replaces the previous steps; empty string clears them."),
      tags: z.array(z.string()).optional().describe("Replaces the user's labels (badges); [] clears them"),
      imported: z.boolean().optional().describe("Set false to clear the 'imported' mark"),
    },
    ({ card, ...patch }) =>
      inProject(card, (project) => deps.daemon.request("PATCH", cardPath(card, project), patch)),
  );

  server.tool(
    "kanban_move",
    "Move a card to another status. Enforces valid transitions (a backlog card can only go to the queue); moving to 'doing' needs an approved plan or planSkipped.",
    { card: z.string(), status: StatusSchema },
    ({ card, status }) =>
      inProject(card, (project) =>
        deps.daemon.request("POST", `/api/cards/${encodeURIComponent(card)}/move?${q(project)}`, { status }),
      ),
  );

  server.tool(
    "kanban_finish",
    "Finish a card: removes it from the board. Does NOT commit or push; that is a separate user request. With openExternal=true, opens the card's external link in the browser after removing it.",
    { card: z.string(), openExternal: z.boolean().optional() },
    ({ card, openExternal }) =>
      inProject(card, async (project) => {
        const removed = await deps.daemon.request<Card>("DELETE", cardPath(card, project));
        let opened = false;
        if (openExternal && removed.externalUrl) {
          deps.openUrl?.(removed.externalUrl);
          opened = true;
        }
        return {
          finished: removed.title,
          externalUrl: removed.externalUrl,
          opened,
          ...(openExternal && !removed.externalUrl ? { note: "The card has no external link." } : {}),
        };
      }),
  );

  server.tool(
    "kanban_branch_name",
    "Get the git branch name derived from a card title (e.g. 'tarefa 123' -> 'tarefa_123'). Does not touch git.",
    { card: z.string() },
    ({ card }) =>
      inProject(card, async (project) => {
        const found = await deps.daemon.request<Card>("GET", cardPath(card, project));
        return { card: found.title, branch: branchNameFromTitle(found.title) };
      }),
  );

  server.tool(
    "kanban_export",
    "Export cards of the current project to a shareable JSON file (title, scope, extras, external link and plan content and the column the card was in; never branch or approval). Omit `cards` to export all of them. The file goes to `path` or, by default, to the folder Claude was opened in as <name>.kanban.json.",
    {
      name: z.string().min(1).describe("Name of the export, e.g. 'cards-extra-activities'"),
      cards: z.array(z.string()).optional().describe("Card ids or titles; omit for every card of the project"),
      path: z.string().optional().describe("Destination file or folder"),
    },
    async ({ name, cards, path: dest }) => {
      const project = await currentProject();
      try {
        const all = await deps.daemon.request<Card[]>("GET", `/api/cards?${q(project.root)}`);
        const picked = cards
          ? cards.map((id) => {
              const found = all.find((c) => c.id === id) ?? all.find((c) => c.title === id);
              if (!found) throw new Error(`Card "${id}" not found in this project`);
              return found;
            })
          : all;
        if (!picked.length) return fail("There are no cards to export.");
        const target = path.resolve(deps.getCwd(), dest ?? ".");
        const isDir = !target.endsWith(".json") || (await fs.stat(target).then((s) => s.isDirectory(), () => false));
        const file = isDir ? path.join(target, `${slug(name)}.kanban.json`) : target;
        const bundle = await deps.daemon.request<Bundle>("POST", "/api/export", { name, ids: picked.map((c) => c.id) });
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(bundle, null, 2), "utf8");
        return text({ file, exported: picked.map((c) => c.title), withPlan: bundle.cards.filter((c) => c.plan).length });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.tool(
    "kanban_import_bundle",
    "Import cards from a file made by kanban_export into the queue, marked 'imported'. By default they go to the current project; `directory` sends them to another existing folder (a project that is not registered yet is created), and `projectDirs` maps a project name of the file to its folder. Without confirm=true it only returns a preview (nothing is created). A plan in the file is saved as a suggestion; it is never approved. Title clashes follow onDuplicate ('skip' or 'rename').",
    {
      path: z.string(),
      directory: z.string().optional().describe("Folder for the cards; default: the current project"),
      projectDirs: z.record(z.string()).optional().describe("Project name in the file -> folder; overrides `directory`"),
      confirm: z.boolean().optional(),
      onDuplicate: z.enum(["skip", "rename"]).optional(),
    },
    async ({ path: file, directory, projectDirs, confirm, onDuplicate }) => {
      const project = await currentProject();
      try {
        const bundle = await readBundle(path.resolve(deps.getCwd(), file));
        const fallback = directory ? path.resolve(deps.getCwd(), directory) : project.root;
        const dirs: Record<string, string> = {};
        for (const c of bundle.cards) dirs[c.project ?? ""] = projectDirs?.[c.project ?? ""] ?? fallback;
        return text(await deps.daemon.request("POST", "/api/import", { bundle, dirs, confirm, onDuplicate }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.tool(
    "kanban_stop",
    "Stop the kanban daemon (shared by every Claude session; it restarts automatically on the next kanban tool call). Cards are kept on disk.",
    {},
    async () => {
      try {
        const result = await deps.daemon.stop();
        return text(result.stopped ? { stopped: true, pid: result.pid } : { stopped: false, note: "No daemon was running." });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.tool(
    "kanban_open",
    "Return the URL of the visual kanban board and open it in the browser.",
    {},
    async () => {
      try {
        const project = await currentProject();
        const url = `${await deps.daemon.baseUrl()}/?${q(project.root)}`;
        deps.openUrl?.(url);
        return text({ url });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  return server;
}
