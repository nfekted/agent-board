import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CardSchema,
  isWithin,
  normalizeTags,
  slug,
  validLink,
  type Bundle,
  loadBoard,
  moveCard,
  saveBoard,
  type Board,
  type Card,
  type Status,
} from "@agent-board/core";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export type CardPatch = Partial<
  Pick<
    Card,
    | "title"
    | "scope"
    | "originalScope"
    | "extras"
    | "substatus"
    | "blockReason"
    | "planningStep"
    | "plan"
    | "planApproved"
    | "planSkipped"
    | "branch"
    | "externalUrl"
    | "tags"
    | "testSteps"
  > & { /** false clears the imported tag */ imported: boolean }
>;

export interface NewCard {
  title: string;
  scope?: string;
  repo: string;
  origin?: string;
  externalUrl?: string;
  tags?: string[];
  /** Only "backlog" differs from the default (queue). */
  status?: "queue" | "backlog";
}

export class InvalidProjectError extends Error {}

type Listener = (event: { type: string; card?: Card; id?: string }) => void;

/**
 * Owns the board file. All mutations are serialized through a promise chain
 * so concurrent API calls never interleave read-modify-write cycles.
 */
export class BoardService {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();

  constructor(readonly file: string) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: Parameters<Listener>[0]): void {
    for (const fn of this.listeners) fn(event);
  }

  private mutate<T>(fn: (board: Board) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const board = await loadBoard(this.file);
      const result = await fn(board);
      await saveBoard(this.file, board);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Registered projects plus every project that has cards, sorted. */
  async listProjects(): Promise<string[]> {
    await this.queue;
    const board = await loadBoard(this.file);
    return [...new Set([...board.projects, ...board.cards.map((c) => c.repo)])].sort();
  }

  /** Registers a project folder (must be an existing directory). Idempotent. */
  addProject(dir: string): Promise<string[]> {
    return this.mutate(async (board) => {
      const project = path.resolve(dir);
      const stat = await fs.stat(project).catch(() => undefined);
      if (!stat?.isDirectory()) throw new InvalidProjectError(`"${project}" is not an existing directory`);
      if (!board.projects.includes(project)) {
        board.projects.push(project);
        this.emit({ type: "board.changed" });
      }
      return [...new Set([...board.projects, ...board.cards.map((c) => c.repo)])].sort();
    });
  }

  /** Unregisters a project folder. Refused while it has cards (including the ones in folders inside it). */
  removeProject(dir: string): Promise<string[]> {
    return this.mutate((board) => {
      const project = path.resolve(dir);
      const count = board.cards.filter((c) => isWithin(c.repo, project)).length;
      if (count) throw new ConflictError(`Project has ${count} card(s); finish or delete them first`);
      if (!board.projects.includes(project)) throw new NotFoundError(`No project "${project}"`);
      board.projects = board.projects.filter((p) => p !== project);
      this.emit({ type: "board.changed" });
      return [...new Set([...board.projects, ...board.cards.map((c) => c.repo)])].sort();
    });
  }

  async list(repo?: string): Promise<Card[]> {
    await this.queue;
    const { cards } = await loadBoard(this.file);
    // a project includes the folders inside it
    return repo ? cards.filter((c) => isWithin(c.repo, path.resolve(repo))) : cards;
  }

  /** Finds by id, or by title (optionally restricted to a project and the folders inside it). */
  async get(idOrTitle: string, repo?: string): Promise<Card> {
    await this.queue;
    const board = await loadBoard(this.file);
    return board.cards[this.find(board, idOrTitle, repo)]!;
  }

  create(input: NewCard): Promise<Card> {
    return this.mutate((board) => {
      const repo = path.resolve(input.repo);
      if (board.cards.some((c) => c.repo === repo && c.title === input.title)) {
        throw new ConflictError(`Card "${input.title}" already exists in ${repo}`);
      }
      const now = new Date().toISOString();
      const card = CardSchema.parse({
        id: randomUUID().slice(0, 8),
        title: input.title,
        scope: input.scope ?? "",
        originalScope: input.scope,
        repo,
        origin: input.origin,
        externalUrl: input.externalUrl || undefined,
        tags: normalizeTags(input.tags),
        status: input.status === "backlog" ? "backlog" : undefined,
        createdAt: now,
        updatedAt: now,
      });
      board.cards.push(card);
      this.emit({ type: "card.created", card });
      return card;
    });
  }

  update(idOrTitle: string, patch: CardPatch, repo?: string): Promise<Card> {
    return this.mutate((board) => {
      const idx = this.find(board, idOrTitle, repo);
      const current = board.cards[idx]!;
      if (patch.title && patch.title !== current.title) {
        const clash = board.cards.some(
          (c) => c.repo === current.repo && c.title === patch.title && c.id !== current.id,
        );
        if (clash) throw new ConflictError(`Card "${patch.title}" already exists in this repo`);
      }
      const next = CardSchema.parse({
        ...current,
        ...patch,
        // an empty string clears the steps
        testSteps: "testSteps" in patch ? patch.testSteps || undefined : current.testSteps,
        tags: "tags" in patch ? normalizeTags(patch.tags) : current.tags,
        imported: "imported" in patch && !patch.imported ? undefined : current.imported,
        // an empty string clears the link
        externalUrl: "externalUrl" in patch ? patch.externalUrl || undefined : current.externalUrl,
        // the reason only lives while the card is blocked; an empty string clears it
        blockReason:
          ("substatus" in patch && patch.substatus !== "blocked") || ("blockReason" in patch && !patch.blockReason)
            ? undefined
            : "blockReason" in patch
              ? patch.blockReason
              : current.blockReason,
        updatedAt: new Date().toISOString(),
      });
      board.cards[idx] = next;
      this.emit({ type: "card.updated", card: next });
      return next;
    });
  }

  /** `before` (a card id of the destination column, or null for the end) also places the card; omitted, the card keeps its place. */
  move(idOrTitle: string, to: Status, repo?: string, before?: string | null): Promise<Card> {
    return this.mutate((board) => {
      const idx = this.find(board, idOrTitle, repo);
      const next = moveCard(board.cards[idx]!, to);
      board.cards[idx] = next;
      if (before !== undefined) this.place(board, next, before);
      this.emit({ type: "card.updated", card: next });
      return next;
    });
  }

  /** Reorders inside its column: right above card `before`, or at the end of the column when `before` is null. */
  reorder(idOrTitle: string, before: string | null, repo?: string): Promise<Card> {
    return this.mutate((board) => {
      const card = board.cards[this.find(board, idOrTitle, repo)]!;
      this.place(board, card, before);
      this.emit({ type: "card.updated", card });
      return card;
    });
  }

  /** The order of `board.cards` is the order on the board; cards of the same column keep their relative order. */
  private place(board: Board, card: Card, before: string | null): void {
    board.cards.splice(board.cards.indexOf(card), 1);
    if (before === null) {
      const last = board.cards.map((c) => c.status).lastIndexOf(card.status);
      board.cards.splice(last + 1, 0, card);
      return;
    }
    const target = board.cards.findIndex((c) => c.id === before && c.status === card.status);
    if (target < 0) throw new NotFoundError(`Card "${before}" not found in the same column`);
    board.cards.splice(target, 0, card);
  }

  /** Removes the card from the board (finish and manual delete are the same operation) and its plan file, if it lives in the plans folder. */
  remove(idOrTitle: string, repo?: string): Promise<Card> {
    return this.mutate(async (board) => {
      const idx = this.find(board, idOrTitle, repo);
      const [card] = board.cards.splice(idx, 1);
      if (card!.plan && isWithin(path.resolve(card!.plan), path.join(path.dirname(this.file), "plans"))) {
        await fs.rm(card!.plan, { force: true });
      }
      this.emit({ type: "card.removed", id: card!.id });
      return card!;
    });
  }

  /** Builds a shareable bundle from cards by id (every card when `ids` is omitted). */
  async exportBundle(name: string, ids?: string[]): Promise<Bundle> {
    await this.queue;
    const { cards } = await loadBoard(this.file);
    const picked = ids
      ? ids.map((id) => cards.find((c) => c.id === id) ?? this.missing(id))
      : cards;
    if (!picked.length) throw new NotFoundError("There are no cards to export");
    // project folders travel by name, never by path; equal names get a suffix
    const names = new Map<string, string>();
    for (const repo of new Set(picked.map((c) => c.repo))) {
      const base = path.basename(repo) || repo;
      let unique = base;
      for (let n = 2; [...names.values()].includes(unique); n++) unique = `${base} (${n})`;
      names.set(repo, unique);
    }
    return {
      kanbanBundle: 2,
      name,
      exportedAt: new Date().toISOString(),
      cards: await Promise.all(
        picked.map(async (c) => ({
          title: c.title,
          scope: c.scope,
          extras: c.extras,
          externalUrl: c.externalUrl,
          tags: c.tags,
          plan: c.plan ? await fs.readFile(c.plan, "utf8").catch(() => undefined) : undefined,
          project: names.get(c.repo),
          from: c.status === "queue" && c.imported ? c.imported : { status: c.status, planningStep: c.planningStep },
        })),
      ),
    };
  }

  private missing(id: string): never {
    throw new NotFoundError(`Card "${id}" not found`);
  }

  /**
   * Imports a bundle into the queue. `dirs` maps each project name of the bundle ("" for version 1 files)
   * to the folder it goes to. Without `confirm` it only returns a preview and writes nothing.
   */
  async importBundle(bundle: Bundle, dirs: Record<string, string>, opts: { confirm?: boolean; onDuplicate?: "skip" | "rename" } = {}) {
    await this.queue;
    const board = await loadBoard(this.file);
    const dirOf = (project?: string) => (dirs[project ?? ""] ? path.resolve(dirs[project ?? ""]!) : undefined);
    const taken = (dir: string) => new Set(board.cards.filter((c) => c.repo === dir).map((c) => c.title));
    const projects = [...new Set(bundle.cards.map((c) => c.project ?? ""))].map((name) => ({ name, dir: dirOf(name) }));
    const rows = bundle.cards.map((c) => {
      const dir = dirOf(c.project);
      const link = validLink(c.externalUrl);
      return {
        project: c.project ?? "",
        title: c.title,
        link,
        droppedLink: c.externalUrl && !link ? c.externalUrl : undefined,
        hasPlan: !!c.plan,
        scopeStart: c.scope.split("\n", 1)[0]?.slice(0, 80),
        from: c.from,
        duplicate: dir ? taken(dir).has(c.title) : false,
      };
    });
    if (!opts.confirm) return { preview: true as const, name: bundle.name, exportedAt: bundle.exportedAt, projects, cards: rows };

    for (const { name, dir } of projects) {
      const stat = dir ? await fs.stat(dir).catch(() => undefined) : undefined;
      if (!stat?.isDirectory()) throw new InvalidProjectError(`Choose an existing folder for project "${name || bundle.name}"`);
    }
    return this.mutate(async (live) => {
      const created: string[] = [];
      const skipped: string[] = [];
      const now = new Date().toISOString();
      for (const c of bundle.cards) {
        const repo = dirOf(c.project)!;
        const existing = new Set(live.cards.filter((x) => x.repo === repo).map((x) => x.title));
        let title = c.title;
        if (existing.has(title)) {
          if (opts.onDuplicate !== "rename") {
            skipped.push(title);
            continue;
          }
          for (let n = 2; existing.has(title); n++) title = `${c.title} (${n})`;
        }
        const id = randomUUID().slice(0, 8);
        const card = CardSchema.parse({
          id,
          title,
          scope: c.scope,
          originalScope: c.scope || undefined,
          extras: c.extras,
          repo,
          externalUrl: validLink(c.externalUrl),
          tags: normalizeTags(c.tags),
          imported: c.from ?? { status: "queue" },
          createdAt: now,
          updatedAt: now,
        });
        live.cards.push(card);
        created.push(title);
        if (c.plan) {
          const plans = path.join(path.dirname(this.file), "plans");
          card.plan = path.join(plans, `${slug(title)}-${id}.md`);
          await fs.mkdir(plans, { recursive: true });
          await fs.writeFile(card.plan, c.plan, "utf8");
        }
        this.emit({ type: "card.created", card });
      }
      return { created, skipped, droppedLinks: rows.filter((r) => r.droppedLink).map((r) => r.title) };
    });
  }

  /** Index of the card by id, title or unique id prefix (3+ chars); within a project, cards of that exact folder win over nested ones. */
  private find(board: Board, idOrTitle: string, repo?: string): number {
    const scoped = repo ? path.resolve(repo) : undefined;
    const matches = (pred: (c: Card) => boolean) => {
      const exact = scoped ? board.cards.findIndex((c) => c.repo === scoped && pred(c)) : -1;
      return exact >= 0 ? exact : board.cards.findIndex((c) => (!scoped || isWithin(c.repo, scoped)) && pred(c));
    };
    let idx = matches((c) => c.id === idOrTitle);
    if (idx < 0) idx = matches((c) => c.title === idOrTitle);
    if (idx < 0 && idOrTitle.length >= 3) {
      const byPrefix = board.cards
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.id.startsWith(idOrTitle) && (!scoped || isWithin(c.repo, scoped)));
      if (byPrefix.length > 1) throw new ConflictError(`Id prefix "${idOrTitle}" matches more than one card`);
      if (byPrefix.length === 1) idx = byPrefix[0]!.i;
    }
    if (idx < 0) throw new NotFoundError(`Card "${idOrTitle}" not found`);
    return idx;
  }
}
