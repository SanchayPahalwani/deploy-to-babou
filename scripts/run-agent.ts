/**
 * The headline path: a headless Claude Code agent drafts the campaign by
 * driving Babou's MCP tools. The agent — not a hand-written script — reads the
 * deploy context and decides the chapter structure.
 *
 * Mode is chosen by credentials, and ONLY the MCP target changes:
 *   - no BABOU_API_KEY -> talk to the LOCAL mock MCP server (stdio). Needs only
 *     an Anthropic key; proves agentic decision-making with zero Babou creds.
 *   - BABOU_API_KEY set -> talk to the real https://api.babou.ai/mcp (http).
 *
 * Safety: ExportProject is omitted from --allowedTools (uncallable in headless
 * -p mode) AND explicitly in --disallowedTools, AND the system prompt forbids
 * it, AND scripts/assert-draft.ts fails CI if it ever appears in the log.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const hasBabouKey = !!process.env.BABOU_API_KEY;
const mode: "live" | "mock" = hasBabouKey ? "live" : "mock";
const model = process.env.AGENT_MODEL || "sonnet";
const logPath = process.env.BABOU_MOCK_LOG || "mock-calls.jsonl";

// Start each run from a clean log so assert-draft sees only this run.
if (existsSync(logPath)) rmSync(logPath);

const context = existsSync("CONTEXT.md")
  ? readFileSync("CONTEXT.md", "utf8")
  : readFileSync("fixtures/sample-deploy.json", "utf8");
const systemPrompt = readFileSync("agent/system-prompt.md", "utf8");
const productName = process.env.PRODUCT_NAME || "this product";

const mcpConfig =
  mode === "mock"
    ? JSON.stringify({
        mcpServers: {
          babou: { command: "npx", args: ["tsx", "agent/mock-babou-mcp.ts"], env: { BABOU_MOCK_LOG: logPath } },
        },
      })
    : JSON.stringify({
        mcpServers: {
          babou: {
            type: "http",
            url: "https://api.babou.ai/mcp",
            headers: { Authorization: `Bearer ${process.env.BABOU_API_KEY}` },
          },
        },
      });

const task = [
  `A new version of "${productName}" just shipped. Draft a Babou video campaign about what changed,`,
  `using the babou MCP tools. Follow your system prompt exactly. Do NOT export — leave it as a draft.`,
  ``,
  `--- DEPLOY CONTEXT ---`,
  context,
].join("\n");

const args = [
  "-p",
  "--mcp-config",
  mcpConfig,
  "--strict-mcp-config",
  "--allowedTools",
  "mcp__babou__ListProjects mcp__babou__CreateProject mcp__babou__AddChapter mcp__babou__AddPrompt",
  "--disallowedTools",
  "mcp__babou__ExportProject",
  "--append-system-prompt",
  systemPrompt,
  "--output-format",
  "json",
  "--model",
  model,
];

const target = mode === "mock" ? "local mock MCP server" : "api.babou.ai/mcp";
console.log(`[agent:${mode}] launching headless claude (${model}) against the ${target} ...`);

let out = "";
try {
  out = execFileSync("claude", args, {
    input: task,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (err) {
  console.error(`[agent] claude invocation failed: ${(err as Error).message}`);
  console.error("[agent] Ensure Claude Code is installed and ANTHROPIC_API_KEY is set.");
  process.exit(1);
}

writeFileSync("agent-output.json", out);
try {
  const parsed = JSON.parse(out);
  if (parsed?.result) console.log(`[agent] result: ${String(parsed.result).slice(0, 500)}`);
} catch {
  /* output wasn't JSON; raw output is saved to agent-output.json */
}
console.log(`[agent] done. Call log at ${logPath}. Run 'npm run assert' to verify the draft invariant.`);
