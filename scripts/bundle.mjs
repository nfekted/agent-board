// Builds plugin/dist: one JS file (MCP server + daemon, dependencies included) plus the compiled UI.
// Run through `npm run bundle`, which compiles the packages first.
import { build } from "esbuild";
import { cp, rm } from "node:fs/promises";

const out = "plugin/dist";
await rm(out, { recursive: true, force: true });

await build({
  entryPoints: ["packages/mcp/src/cli.ts"],
  outfile: `${out}/agent-board.mjs`,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: true,
  legalComments: "none",
  define: { BUNDLED: "true" },
  // some dependencies are CommonJS and call require() on Node built-ins
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await cp("packages/ui/dist", `${out}/ui`, { recursive: true });
console.log(`bundle ready in ${out}`);
