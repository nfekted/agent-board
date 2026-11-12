import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readRunningDaemon } from "@agent-board/server";

const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../plugin");
const read = (p: string) => fs.readFile(path.join(plugin, p), "utf8");

function frontmatter(md: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  expect(m, "missing frontmatter").not.toBeNull();
  return Object.fromEntries(
    m![1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]),
  );
}

describe("plugin structure", () => {
  it("has a valid manifest named agent-board", async () => {
    expect(JSON.parse(await read(".claude-plugin/plugin.json")).name).toBe("agent-board");
  });

  it("every command has a description and the skill is named", async () => {
    for (const f of await fs.readdir(path.join(plugin, "commands"))) {
      expect(frontmatter(await read(`commands/${f}`)).description, f).toBeTruthy();
    }
    expect(frontmatter(await read("skills/kanban-workflow/SKILL.md")).name).toBe("kanban-workflow");
  });

  it("commands only reference sections that exist in the skill", async () => {
    const skill = await read("skills/kanban-workflow/SKILL.md");
    for (const [file, section] of [["start.md", "Start flow"], ["finish.md", "Finish"], ["import.md", "Import"], ["import.md", "Import a shared export"], ["export.md", "Export"]] as const) {
      expect(await read(`commands/${file}`)).toContain(`"${section}"`);
      expect(skill).toMatch(new RegExp(`^## ${section}$`, "m"));
    }
  });

  it("ships a default scope format and the skill points at it", async () => {
    expect((await read("skills/kanban-workflow/format-instruction.default.md")).length).toBeGreaterThan(200);
    expect(await read("skills/kanban-workflow/SKILL.md")).toContain("format-instruction.default.md");
  });

  it("the skill only mentions tools the MCP actually exposes", async () => {
    const used = new Set((await read("skills/kanban-workflow/SKILL.md")).match(/kanban_[a-z_]+/g));
    const exposed = ["kanban_branch_name", "kanban_create", "kanban_export", "kanban_finish", "kanban_get", "kanban_import_bundle", "kanban_list", "kanban_move", "kanban_open", "kanban_project_info", "kanban_stop", "kanban_update"];
    for (const name of used) expect(exposed, name).toContain(name);
  });
});

describe("plugin MCP over stdio", () => {
  it("launches from .mcp.json and lists the repo's cards via the project dir", async () => {
    const config = JSON.parse(await read(".mcp.json")).mcpServers.kanban as { command: string; args: string[] };
    const args = config.args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", plugin));
    await fs.access(args[0]!); // the built bin must exist

    const home = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-stdio-"));
    const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kanban-proj-")));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    const transport = new StdioClientTransport({
      command: config.command,
      args,
      cwd: os.tmpdir(), // not the project: the project must come from CLAUDE_PROJECT_DIR
      env: { ...process.env, KANBAN_HOME: home, CLAUDE_PROJECT_DIR: repo } as Record<string, string>,
    });
    const client = new Client({ name: "t", version: "0" });
    try {
      await client.connect(transport);
      const created = (await client.callTool({ name: "kanban_create", arguments: { title: "1" } })) as {
        content: { text: string }[];
      };
      expect(JSON.parse(created.content[0]!.text).repo).toBe(repo);
    } finally {
      await client.close();
      const daemon = await readRunningDaemon(home);
      if (daemon) process.kill(daemon.pid, "SIGTERM"); // the MCP auto-started a detached daemon
    }
  }, 20000);
});
