/**
 * Turns a card title into a valid git branch name, keeping it as close to the
 * title as possible ("1234" -> "1234", "tarefa 123" -> "tarefa_123").
 * Follows the rules of `git check-ref-format`.
 */
export function branchNameFromTitle(title: string, template = "{title}"): string {
  const raw = template.replace("{title}", title);
  let name = raw
    .trim()
    .replace(/\s+/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f~^:?*[\]\\]/g, "")
    .replace(/@\{/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-.\/]+/, "")
    .replace(/[.\/]+$/, "")
    .replace(/\.lock$/, "");
  name = name
    .split("/")
    .map((part) => part.replace(/^\.+/, "").replace(/\.lock$/, ""))
    .filter(Boolean)
    .join("/");
  if (!name || name === "@") throw new Error(`Cannot derive a valid branch name from "${title}"`);
  return name;
}
