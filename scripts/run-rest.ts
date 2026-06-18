/**
 * Deterministic REPLAY mode (default, $0, no agent) and the live REST fallback.
 *
 *   - no BABOU_API_KEY -> MockTransport (offline, proves the call contract)
 *   - BABOU_API_KEY set -> RestTransport (creates a real draft via REST)
 *
 * Either way it builds Project -> Chapters -> Prompts and STOPS before export.
 * Writes plan.json and mock-calls.jsonl so `assert-draft` can verify uniformly.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runDraftCampaign } from "../src/orchestrator.js";
import { MockTransport, RestTransport, type DraftTransport } from "../src/transport.js";
import type { DeployContext } from "../src/types.js";

function loadContext(): DeployContext {
  const path = existsSync("context.json") ? "context.json" : "fixtures/sample-deploy.json";
  return JSON.parse(readFileSync(path, "utf8")) as DeployContext;
}

const ctx = loadContext();
const apiKey = process.env.BABOU_API_KEY;
const live = !!apiKey;
const transport: DraftTransport = live ? new RestTransport({ apiKey: apiKey! }) : new MockTransport();

const result = await runDraftCampaign(ctx, transport);

writeFileSync("plan.json", JSON.stringify(result, null, 2));
writeFileSync("mock-calls.jsonl", result.calls.map((c) => JSON.stringify(c)).join("\n") + "\n");

const mode = live ? "LIVE (REST)" : "REPLAY (mock)";
console.log(
  `[${mode}] ${result.status} draft ${result.projectId} — ${result.chapters.length} chapters, exported=${result.exported}`,
);
console.log("Call sequence:", result.calls.map((c) => c.tool).join(" -> "));
if (!live) console.log("No BABOU_API_KEY set — ran against the in-memory mock. Set the key to create a real draft.");
