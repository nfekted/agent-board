import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import Sortable from "sortablejs";
import { api, STATUSES, subscribe, type Card, type Status } from "./api";
import { Mini } from "./Mini";
import { ExportDialog, ImportDialog } from "./Share";
import { detectLang, translate, type Key, type Lang } from "./i18n";

const safeStorage = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const initialRepo = new URLSearchParams(location.search).get("repo") ?? "";
const startRepo = initialRepo || safeStorage.get("kanban.repo");
const repoName = (repo: string) => repo.split("/").filter(Boolean).pop() ?? repo;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); // ignore case and accents
const parseTags = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function App() {
  const [cards, setCards] = useState<Card[]>([]);
  const [repo, setRepo] = useState(startRepo); // "" = all projects
  const [projects, setProjects] = useState<string[]>([]);
  const [newProject, setNewProject] = useState("");
  const [lang, setLang] = useState<Lang>(detectLang());
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  const [pip, setPip] = useState<Window>();
  const [share, setShare] = useState<"export" | "import">();
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [backlogOpen, setBacklogOpen] = useState(safeStorage.get("kanban.backlogOpen") === "1");
  const t = (key: Key, vars?: Record<string, string>) => translate(lang, key, vars);

  const refresh = () =>
    Promise.all([api.list(), api.projects()])
      .then(([c, p]) => { setCards(c); setProjects(p); })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void refresh();
    return subscribe(() => void refresh());
  }, []);

  const repos = useMemo(() => {
    const set = new Set([...projects, ...cards.map((c) => c.repo)]);
    if (startRepo) set.add(startRepo);
    return [...set].sort();
  }, [cards, projects]);

  const chooseRepo = (value: string) => {
    setRepo(value);
    safeStorage.set("kanban.repo", value);
  };

  async function addProject() {
    const dir = newProject.trim();
    if (!dir) return;
    try {
      setProjects(await api.addProject(dir));
      chooseRepo(dir);
      setNewProject("");
    } catch (e) {
      showError(e);
    }
  }

  async function removeProject() {
    if (!window.confirm(t("project.remove.confirm", { name: repoName(repo) }))) return;
    try {
      setProjects(await api.removeProject(repo));
      chooseRepo("");
    } catch (e) {
      showError(e);
    }
  }

  const within = (child: string, parent: string) => child === parent || child.startsWith(parent.replace(/[\\/]$/, "") + (parent.includes("\\") ? "\\" : "/"));
  const visible = repo ? cards.filter((c) => within(c.repo, repo)) : cards;
  const matches = (c: Card) => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const haystack = fold([c.title, ...c.tags, c.externalUrl ?? ""].join("\n"));
    return words.every((w) => haystack.includes(w));
  };
  useEffect(() => {
    const blocked = visible.filter((c) => c.substatus === "blocked").length;
    const waiting = visible.filter((c) => c.status === "validation").length;
    const flags = [blocked && `!${blocked}`, waiting && `✓${waiting}`].filter(Boolean).join(" ");
    document.title = flags ? `(${flags}) Kanban` : "Kanban";
  }, [visible]);
  const showError = (e: unknown) => {
    setError((e as Error).message);
    setTimeout(() => setError(""), 5000);
  };

  // a position is only meaningful on the full list: while the filter hides cards, drops keep the old place
  const positioned = (before?: string | null) => (query.trim() ? undefined : before);

  async function move(id: string, status: Status, before?: string | null) {
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    try {
      if (card.status !== status) await api.move(card, status, positioned(before));
      else if (positioned(before) !== undefined) await api.reorder(card, positioned(before)!);
    } catch (e) {
      showError(e);
    }
    await refresh(); // also reverts the optimistic DOM move done by drag&drop on failure
  }

  const detail = cards.find((c) => c.id === selected);

  async function openMini() {
    const api = (window as unknown as { documentPictureInPicture?: { requestWindow(o: object): Promise<Window> } }).documentPictureInPicture;
    try {
      if (!api) throw new Error("documentPictureInPicture is not available");
      const w = await api.requestWindow({ width: 340, height: 230 });
      for (const sheet of [...document.styleSheets]) {
        const style = w.document.createElement("style");
        try { style.textContent = [...sheet.cssRules].map((r) => r.cssText).join("\n"); } catch { continue; }
        w.document.head.appendChild(style);
      }
      w.addEventListener("pagehide", () => setPip(undefined));
      setPip(w);
    } catch (e) {
      showError(new Error(t("mini.failed", { reason: (e as Error).message })));
    }
  }

  // keep the mini window in sync with the board
  useEffect(() => {
    if (!pip) return;
    const boardUrl = `${location.origin}/${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`;
    render(<Mini cards={visible} repos={repos} repo={repo} repoName={repoName} onRepo={chooseRepo} boardUrl={boardUrl} t={t} />, pip.document.body);
  });
  useEffect(() => () => pip?.close(), [pip]);

  return (
    <div class="app">
      <header>
        <h1>{t("title")}</h1>
        <label>
          {t("filter.repo")}{" "}
          <select value={repo} onChange={(e) => chooseRepo((e.target as HTMLSelectElement).value)}>
            <option value="">{t("filter.all")}</option>
            {repos.map((r) => (
              <option value={r} key={r} title={r}>
                {repoName(r)}
              </option>
            ))}
          </select>
        </label>
        {repo && (
          <button class="icon" disabled={visible.length > 0} title={visible.length ? t("project.remove.blocked") : t("project.remove")} aria-label={t("project.remove")} onClick={() => void removeProject()}>
            🗑
          </button>
        )}
        <input class="card-filter" type="search" value={query} placeholder={t("filter.cards")} aria-label={t("filter.cards")} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        <form class="add-project" onSubmit={(e) => { e.preventDefault(); void addProject(); }}>
          <input value={newProject} placeholder={t("project.path")} onInput={(e) => setNewProject((e.target as HTMLInputElement).value)} />
          <button type="submit">{t("project.add")}</button>
        </form>
        <button onClick={() => setShare("export")}>{t("share.export")}</button>
        <button onClick={() => setShare("import")}>{t("share.import")}</button>
        <button onClick={() => (pip ? pip.close() : void openMini())}>{pip ? t("mini.close") : t("mini.open")}</button>
        <select
          value={lang}
          aria-label="language"
          onChange={(e) => {
            const next = (e.target as HTMLSelectElement).value as Lang;
            localStorage.setItem("kanban.lang", next);
            setLang(next);
          }}
        >
          <option value="en">English</option>
          <option value="pt-BR">Português</option>
        </select>
      </header>

      {error && <div class="toast" role="alert">{error}</div>}
      {notice && <div class="toast ok" role="status">{notice}</div>}

      {share === "export" && <ExportDialog cards={visible} t={t} onClose={() => setShare(undefined)} onError={showError} />}
      {share === "import" && (
        <ImportDialog
          repos={repos}
          repo={repo}
          t={t}
          onClose={() => setShare(undefined)}
          onError={showError}
          onDone={(message) => { setNotice(message); setTimeout(() => setNotice(""), 5000); void refresh(); }}
        />
      )}

      <main class={backlogOpen || query.trim() ? "" : "backlog-collapsed"}>
        {STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            title={t(`col.${status}` as Key)}
            cards={visible.filter((c) => c.status === status && matches(c))}
            showRepo={!repo}
            onMove={move}
            onOpen={setSelected}
            collapsed={status === "backlog" && !backlogOpen && !query.trim()}
            onToggle={status === "backlog" ? () => { setBacklogOpen(!backlogOpen); safeStorage.set("kanban.backlogOpen", backlogOpen ? "0" : "1"); } : undefined}
            t={t}
          >
            {status === "queue" && (
              <NewCard repo={repo} t={t} onCreate={(title, scope, link, tags) => api.create(title, scope, repo, link, tags).then(refresh).catch(showError)} />
            )}
          </Column>
        ))}
      </main>

      {detail && (
        <Detail
          card={detail}
          t={t}
          onClose={() => setSelected(undefined)}
          onSave={(patch) => api.update(detail, patch).then(() => { setSelected(undefined); return refresh(); }).catch(showError)}
          onDelete={() => {
            if (!confirm(t("card.confirmDelete", { title: detail.title }))) return;
            api.remove(detail).then(() => { setSelected(undefined); return refresh(); }).catch(showError);
          }}
        />
      )}
    </div>
  );
}

interface ColumnProps {
  status: Status;
  title: string;
  cards: Card[];
  showRepo: boolean;
  onMove: (id: string, status: Status, before: string | null) => void;
  onOpen: (id: string) => void;
  collapsed: boolean;
  onToggle?: () => void;
  t: (key: Key, vars?: Record<string, string>) => string;
  children?: preact.ComponentChildren;
}

function Column({ status, title, cards, showRepo, onMove, onOpen, collapsed, onToggle, t, children }: ColumnProps) {
  const list = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const sortable = Sortable.create(list.current!, {
      group: "cards",
      animation: 150,
      // dropped inside this column (from another one, or reordered): `before` is the card now right below it
      onAdd: (evt) => onMoveRef.current(evt.item.dataset.id!, status, (evt.item.nextElementSibling as HTMLElement | null)?.dataset.id ?? null),
      onUpdate: (evt) => onMoveRef.current(evt.item.dataset.id!, status, (evt.item.nextElementSibling as HTMLElement | null)?.dataset.id ?? null),
    });
    return () => sortable.destroy();
  }, [status]);

  return (
    <section class={`column col-${status}${collapsed ? " collapsed" : ""}`}>
      <h2 class={onToggle ? "toggle" : ""} onClick={onToggle}>
        {onToggle && <span aria-hidden="true">{collapsed ? "▸ " : "▾ "}</span>}
        {title} <span class="count">{cards.length}</span>
      </h2>
      {children}
      <div class="cards" ref={list}>
        {cards.map((card) => (
          <article key={card.id} data-id={card.id} class="card" onClick={() => onOpen(card.id)}>
            <strong>{card.title}</strong>
            <div class="card-id">{card.id}</div>
            {showRepo && <span class="repo">{repoName(card.repo)}</span>}
            {card.substatus === "blocked" && card.blockReason && <p class="block-reason">{card.blockReason}</p>}
            {card.scope && <p>{card.scope.slice(0, 140)}</p>}
            {card.externalUrl && (
              <a class="ext" href={card.externalUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                {t("link.open")} ↗
              </a>
            )}
            <footer>
              {card.substatus && (
                <span class={`badge ${card.substatus}`}>
                  {card.substatus === "waiting-user" ? t("card.waiting") : card.substatus === "blocked" ? t("card.blocked") : t("card.working")}
                </span>
              )}
              {card.tags.map((tag) => <span key={tag} class="badge tag">{tag}</span>)}
              {card.testSteps && <span class="badge muted">{t("card.testSteps")}</span>}
              {card.imported && <span class="badge muted">{t("card.imported")}</span>}
              {card.planSkipped && <span class="badge muted">{t("card.noPlan")}</span>}
              {card.status === "queue" && <CopyStart card={card} t={t} />}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function CopyStart({ card, t }: { card: Card; t: ColumnProps["t"] }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class="link"
      onClick={(e) => {
        e.stopPropagation();
        const cmd = `cd ${shellQuote(card.repo)} && claude "/agent-board:start ${card.title.replace(/["\\$`]/g, "")}"`;
        void navigator.clipboard?.writeText(cmd);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t("card.copied") : t("card.copyStart")}
    </button>
  );
}

function NewCard({ repo, t, onCreate }: { repo: string; t: ColumnProps["t"]; onCreate: (title: string, scope: string, link: string, tags: string[]) => void }) {
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [link, setLink] = useState("");
  const [tags, setTags] = useState("");
  if (!repo) return <p class="hint">{t("new.needRepo")}</p>;
  return (
    <form
      class="new"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onCreate(title.trim(), scope, link.trim(), parseTags(tags));
        setTitle("");
        setScope("");
        setLink("");
        setTags("");
      }}
    >
      <input value={title} placeholder={t("new.title")} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      <textarea value={scope} placeholder={t("new.scope")} rows={2} onInput={(e) => setScope((e.target as HTMLTextAreaElement).value)} />
      <input value={link} placeholder={t("link")} onInput={(e) => setLink((e.target as HTMLInputElement).value)} />
      <input value={tags} placeholder={t("tags")} onInput={(e) => setTags((e.target as HTMLInputElement).value)} />
      <button type="submit">{t("new.add")}</button>
    </form>
  );
}

interface DetailProps {
  card: Card;
  t: ColumnProps["t"];
  onClose: () => void;
  onSave: (patch: { title: string; scope: string; extras: string; externalUrl: string; tags: string[]; testSteps: string }) => void;
  onDelete: () => void;
}

function Detail({ card, t, onClose, onSave, onDelete }: DetailProps) {
  const [title, setTitle] = useState(card.title);
  const [scope, setScope] = useState(card.scope);
  const [extras, setExtras] = useState(card.extras);
  const [externalUrl, setExternalUrl] = useState(card.externalUrl ?? "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [testSteps, setTestSteps] = useState(card.testSteps ?? "");
  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog" role="dialog" onClick={(e) => e.stopPropagation()}>
        <input value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        <div class="card-id">{card.id}</div>
        {card.substatus === "blocked" && <p class="block-reason"><strong>{t("card.blocked")}:</strong> {card.blockReason}</p>}
        <label>{t("detail.scope")}<textarea rows={8} value={scope} onInput={(e) => setScope((e.target as HTMLTextAreaElement).value)} /></label>
        <label>{t("detail.testSteps")}<textarea rows={6} value={testSteps} onInput={(e) => setTestSteps((e.target as HTMLTextAreaElement).value)} /></label>
        <label>{t("detail.extras")}<textarea rows={4} value={extras} onInput={(e) => setExtras((e.target as HTMLTextAreaElement).value)} /></label>
        <label>{t("link")}<input value={externalUrl} onInput={(e) => setExternalUrl((e.target as HTMLInputElement).value)} /></label>
        <label>{t("tags")}<input value={tags} onInput={(e) => setTags((e.target as HTMLInputElement).value)} /></label>
        <dl>
          <dt>{t("detail.plan")}</dt><dd>{card.plan ?? "—"}</dd>
          <dt>{t("detail.branch")}</dt><dd>{card.branch ?? "—"}</dd>
        </dl>
        <div class="actions">
          <button class="danger" onClick={onDelete}>{t("card.delete")}</button>
          <span class="spacer" />
          <button onClick={onClose}>{t("detail.close")}</button>
          <button class="primary" onClick={() => onSave({ title, scope, extras, externalUrl, tags: parseTags(tags), testSteps })}>{t("detail.save")}</button>
        </div>
      </div>
    </div>
  );
}
