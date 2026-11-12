export type Status = "backlog" | "queue" | "planning" | "doing" | "validation";

export interface Card {
  id: string;
  title: string;
  scope: string;
  extras: string;
  status: Status;
  substatus?: "waiting-user" | "working" | "blocked";
  blockReason?: string;
  planningStep?: string;
  plan?: string;
  planApproved: boolean;
  planSkipped: boolean;
  repo: string;
  branch?: string;
  externalUrl?: string;
  tags: string[];
  testSteps?: string;
  imported?: { status: Status; planningStep?: string };
  updatedAt: string;
}

export interface Bundle {
  name: string;
  cards: { title: string; project?: string }[];
  [key: string]: unknown;
}

export interface ImportPreview {
  preview: true;
  name: string;
  projects: { name: string; dir?: string }[];
  cards: { project: string; title: string; hasPlan: boolean; duplicate: boolean; from?: { status: Status } }[];
}

export interface ImportResult {
  created: string[];
  skipped: string[];
}

export const STATUSES: Status[] = ["backlog", "queue", "planning", "doing", "validation"];

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const repoQuery = (repo: string) => `repo=${encodeURIComponent(repo)}`;

export const api = {
  list: () => call<Card[]>("GET", "/api/cards"),
  projects: () => call<string[]>("GET", "/api/projects"),
  addProject: (path: string) => call<string[]>("POST", "/api/projects", { path }),
  removeProject: (path: string) => call<string[]>("DELETE", `/api/projects?path=${encodeURIComponent(path)}`),
  create: (title: string, scope: string, repo: string, externalUrl?: string, tags?: string[]) =>
    call<Card>("POST", "/api/cards", { title, scope, repo, externalUrl: externalUrl || undefined, tags }),
  move: (card: Card, status: Status, before?: string | null) =>
    call<Card>("POST", `/api/cards/${card.id}/move?${repoQuery(card.repo)}`, { status, before }),
  reorder: (card: Card, before: string | null) =>
    call<Card>("POST", `/api/cards/${card.id}/reorder?${repoQuery(card.repo)}`, { before }),
  update: (card: Card, patch: Partial<Pick<Card, "title" | "scope" | "extras" | "externalUrl" | "tags" | "testSteps">>) =>
    call<Card>("PATCH", `/api/cards/${card.id}?${repoQuery(card.repo)}`, patch),
  exportBundle: (name: string, ids: string[]) => call<Bundle>("POST", "/api/export", { name, ids }),
  importPreview: (bundle: Bundle, dirs: Record<string, string>) =>
    call<ImportPreview>("POST", "/api/import", { bundle, dirs }),
  importConfirm: (bundle: Bundle, dirs: Record<string, string>, onDuplicate: "skip" | "rename") =>
    call<ImportResult>("POST", "/api/import", { bundle, dirs, onDuplicate, confirm: true }),
  remove: (card: Card) => call<Card>("DELETE", `/api/cards/${card.id}?${repoQuery(card.repo)}`),
};

const EVENTS = ["hello", "card.created", "card.updated", "card.removed", "board.changed"];

/** Subscribes to daemon events; reconnects automatically (EventSource does). Returns unsubscribe. */
export function subscribe(onEvent: () => void): () => void {
  const source = new EventSource("/api/events");
  for (const name of EVENTS) source.addEventListener(name, onEvent);
  return () => source.close();
}
