import { useState } from "preact/hooks";
import { useDialog } from "./ui";
import { api, type Bundle, type Card, type ImportPreview } from "./api";
import type { Key } from "./i18n";

type T = (key: Key, vars?: Record<string, string>) => string;

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

export function ExportDialog({ cards, t, onClose, onError }: { cards: Card[]; t: T; onClose: () => void; onError: (e: unknown) => void }) {
  const dialog = useDialog(onClose);
  const [name, setName] = useState("agent-board-export");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = cards.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    setPicked(next);
  };

  async function download() {
    try {
      const bundle = await api.exportBundle(name.trim(), [...picked]);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      link.download = `${slug(name.trim())}.kanban.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      onClose();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={t("share.exportTitle")} ref={dialog} onClick={(e) => e.stopPropagation()}>
        <h2>{t("share.exportTitle")}</h2>
        <label>{t("share.name")}<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <input value={filter} placeholder={t("share.filter")} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        <div class="actions">
          <button onClick={() => setPicked(new Set([...picked, ...shown.map((c) => c.id)]))}>{t("share.selectShown")}</button>
          <button onClick={() => setPicked(new Set())}>{t("share.clear")}</button>
          <span class="spacer" />
          <span>{t("share.selected", { n: String(picked.size) })}</span>
        </div>
        <ul class="pick-list">
          {shown.map((c) => (
            <li key={c.id}>
              <label class="pick">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span>{c.title}</span>
                <span class="repo">{c.repo.split("/").filter(Boolean).pop()} · {t(`col.${c.status}` as Key)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div class="actions">
          <span class="spacer" />
          <button onClick={onClose}>{t("detail.close")}</button>
          <button class="primary" disabled={!picked.size || !name.trim()} onClick={() => void download()}>{t("share.download")}</button>
        </div>
      </div>
    </div>
  );
}

export function ImportDialog({ repos, repo, t, onClose, onError, onDone }: {
  repos: string[];
  repo: string;
  t: T;
  onClose: () => void;
  onError: (e: unknown) => void;
  onDone: (message: string) => void;
}) {
  const dialog = useDialog(onClose);
  const [bundle, setBundle] = useState<Bundle>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [dirs, setDirs] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "rename">("skip");

  async function load(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Bundle;
      // suggest a known project with the same folder name, else the project selected on the board
      const suggested: Record<string, string> = {};
      for (const c of parsed.cards ?? []) {
        const name = c.project ?? "";
        suggested[name] ??= repos.find((r) => r.split("/").filter(Boolean).pop() === name) ?? repo;
      }
      setPreview(await api.importPreview(parsed, suggested));
      setBundle(parsed);
      setDirs(suggested);
    } catch (e) {
      onError(e instanceof SyntaxError ? new Error(t("share.notBundle")) : e);
    }
  }

  async function setDir(name: string, dir: string) {
    const next = { ...dirs, [name]: dir };
    setDirs(next);
    if (bundle) setPreview(await api.importPreview(bundle, next).catch(() => preview));
  }

  async function run() {
    try {
      const r = await api.importConfirm(bundle!, dirs, onDuplicate);
      onDone(t("share.done", { created: String(r.created.length), skipped: String(r.skipped.length) }));
      onClose();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div class="overlay" onClick={onClose}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={t("share.import")} ref={dialog} onClick={(e) => e.stopPropagation()}>
        <h2>{t("share.import")}</h2>
        <input type="file" accept=".json,application/json" aria-label={t("share.pickFile")} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void load(f); }} />
        {preview && (
          <>
            <p><strong>{preview.name}</strong></p>
            {preview.projects.map((p) => (
              <label key={p.name}>
                {t("share.folderFor", { project: p.name || preview.name })}
                <input
                  value={dirs[p.name] ?? ""}
                  placeholder={t("share.folderHint")}
                  onInput={(e) => setDirs({ ...dirs, [p.name]: (e.target as HTMLInputElement).value })}
                  onChange={(e) => void setDir(p.name, (e.target as HTMLInputElement).value)}
                />
              </label>
            ))}
            <ul class="pick-list">
              {preview.cards.map((c) => (
                <li key={`${c.project}/${c.title}`}>
                  <strong>{c.title}</strong>{" "}
                  <span class="repo">
                    {[c.project, c.from && c.from.status !== "queue" ? t("share.cameFrom", { status: t(`col.${c.from.status}` as Key) }) : "", c.hasPlan ? t("share.hasPlan") : "", c.duplicate ? t("share.duplicate") : ""].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            <label>
              {t("share.onDuplicate")}
              <select value={onDuplicate} onChange={(e) => setOnDuplicate((e.target as HTMLSelectElement).value as "skip" | "rename")}>
                <option value="skip">{t("share.skip")}</option>
                <option value="rename">{t("share.rename")}</option>
              </select>
            </label>
          </>
        )}
        <div class="actions">
          <span class="spacer" />
          <button onClick={onClose}>{t("detail.close")}</button>
          <button class="primary" disabled={!preview || preview.projects.some((p) => !dirs[p.name]?.trim())} onClick={() => void run()}>{t("share.doImport")}</button>
        </div>
      </div>
    </div>
  );
}
