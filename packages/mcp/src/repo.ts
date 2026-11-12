import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWithin } from "@kanban-mcp/core";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ProjectInfo {
  /** Git root when inside a repository, otherwise the folder Claude runs in. */
  root: string;
  isGit: boolean;
  origin?: string;
}

/**
 * Resolves the project of `cwd`: the git root if there is one, else the folder itself
 * (e.g. a parent folder that contains several repositories).
 */
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd });
    const root = await fs.realpath(stdout.trim());
    const origin = await run("git", ["remote", "get-url", "origin"], { cwd })
      .then((r) => r.stdout.trim() || undefined)
      .catch(() => undefined);
    return { root, isGit: true, origin };
  } catch {
    return { root: await fs.realpath(path.resolve(cwd)), isGit: false };
  }
}

/** Immediate subfolders of `dir` that are git repositories (for multi-repo project folders). */
export async function findChildRepos(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const repos: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (await fs.stat(path.join(dir, entry.name, ".git")).then(() => true, () => false)) {
      repos.push(entry.name);
    }
  }
  return repos.sort();
}

export interface ResolvedProject extends ProjectInfo {
  /** Where Claude actually runs (git root or folder); differs from `root` when folded into a parent project. */
  openedIn: string;
  /** The git repository Claude runs in, if any (a default target for branches and commits). */
  cwdRepo?: string;
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false);

/**
 * Like detectProject, but a folder inside an already known project that is a plain folder
 * (not a git repository) belongs to that project: `projeto/front` joins `projeto`.
 * Never folds into the home folder or the filesystem root, which would swallow every project.
 */
export async function resolveProject(
  cwd: string,
  knownProjects: string[],
  forbidden: string[] = [os.homedir()],
): Promise<ResolvedProject> {
  const found = await detectProject(cwd);
  const blocked = new Set([...forbidden, path.parse(found.root).root]);
  const base = { openedIn: found.root, cwdRepo: found.isGit ? found.root : undefined };

  const ancestors = knownProjects
    .filter((k) => k !== found.root && isWithin(found.root, k) && !blocked.has(k))
    .sort((a, b) => a.length - b.length); // outermost first
  for (const ancestor of ancestors) {
    if ((await exists(ancestor)) && !(await exists(path.join(ancestor, ".git")))) {
      return { root: ancestor, isGit: false, ...base };
    }
  }
  return { ...found, ...base };
}
