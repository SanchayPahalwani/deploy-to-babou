/**
 * Smoke-test the mock Babou MCP server over a real MCP stdio connection — no
 * Anthropic key, no Babou key. Proves the agent's MCP target actually speaks
 * the protocol, exposes all five tools, and logs calls. This is the plumbing
 * underneath the agent path.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync, rmSync } from "node:fs";

const LOG = "smoke-calls.jsonl";
if (existsSync(LOG)) rmSync(LOG);

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "agent/mock-babou-mcp.ts"],
  env: { ...getDefaultEnvironment(), BABOU_MOCK_LOG: LOG },
});
const client = new Client({ name: "smoke-mcp", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("Tools exposed:", names.join(", "));

const created = await client.callTool({
  name: "CreateProject",
  arguments: { name: "Smoke", description: "shipcast:sha=deadbeef" },
});
console.log("CreateProject ->", JSON.stringify((created as { content: unknown }).content));

await client.close();

const expected = ["AddChapter", "AddPrompt", "CreateProject", "ExportProject", "ListProjects"];
const allPresent = expected.every((n) => names.includes(n));
const logged = existsSync(LOG) && readFileSync(LOG, "utf8").includes('"CreateProject"');

if (!allPresent || !logged) {
  console.error("❌ smoke FAILED", { allPresent, logged });
  process.exit(1);
}
console.log("✅ mock MCP server smoke OK — 5 tools exposed over stdio, CreateProject logged.");
rmSync(LOG, { force: true });
