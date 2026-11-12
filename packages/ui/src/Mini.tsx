import type { Card } from "./api";
import type { Key } from "./i18n";

interface MiniProps {
  cards: Card[]; // already filtered by the selected project
  repos: string[];
  repo: string;
  repoName: (repo: string) => string;
  onRepo: (repo: string) => void;
  boardUrl: string;
  t: (key: Key, vars?: Record<string, string>) => string;
}

/** Compact board shown in the always-on-top mini window: project picker and one counter per flag. */
export function Mini({ cards, repos, repo, repoName, onRepo, boardUrl, t }: MiniProps) {
  const blocked = cards.filter((c) => c.substatus === "blocked");
  const count = (status: Card["status"]) => cards.filter((c) => c.status === status).length;
  const chips: { cls: string; label: string; n: number; title?: string }[] = [
    { cls: "", label: t("col.queue"), n: count("queue") },
    { cls: "", label: t("col.planning"), n: count("planning") },
    { cls: "", label: t("col.doing"), n: count("doing") },
    { cls: "blocked", label: t("card.blocked"), n: blocked.length, title: blocked.map((c) => `${c.title}: ${c.blockReason ?? ""}`).join("\n") },
    { cls: "validation", label: t("col.validation"), n: count("validation") },
  ];
  return (
    <div class={`mini${blocked.length ? " alert-blocked" : count("validation") ? " alert-validation" : ""}`}>
      <select value={repo} onChange={(e) => onRepo((e.target as HTMLSelectElement).value)}>
        <option value="">{t("filter.all")}</option>
        {repos.map((r) => (
          <option value={r} key={r} title={r}>{repoName(r)}</option>
        ))}
      </select>
      <div class="chips">
        {chips.map((c) => (
          <div key={c.label} class={`chip ${c.cls}${c.n ? " on" : ""}`} title={c.title}>
            <strong>{c.n}</strong>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <a href={boardUrl} target="_blank" rel="noopener noreferrer">{t("mini.openBoard")} ↗</a>
    </div>
  );
}
