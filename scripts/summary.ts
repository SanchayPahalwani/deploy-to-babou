/**
 * Render a GitHub Actions job summary from the run artifacts. Piped into
 * $GITHUB_STEP_SUMMARY so the drafted campaign is visible right in the run UI.
 */
import { existsSync, readFileSync } from "node:fs";

interface Call {
  tool: string;
  args?: Record<string, unknown>;
}

const plan = existsSync("plan.json") ? JSON.parse(readFileSync("plan.json", "utf8")) : null;
const calls: Call[] = existsSync("mock-calls.jsonl")
  ? readFileSync("mock-calls.jsonl", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Call)
  : [];

const sequence = calls.map((c) => c.tool).join(" → ");
const exported = calls.some((c) => c.tool === "ExportProject");
const chapters = calls.filter((c) => c.tool === "AddChapter").length;
const projectId: string | undefined = plan?.projectId;

const lines: string[] = [];
lines.push("## 🎬 Babou draft campaign");
lines.push("");
if (plan?.status === "exists") {
  lines.push(`A campaign for this deploy already existed (\`${projectId}\`) — skipped to stay idempotent.`);
} else if (projectId) {
  lines.push(`Drafted project \`${projectId}\` with **${chapters} chapter(s)**.`);
} else {
  lines.push("No draft was produced.");
}
lines.push("");
lines.push(`**Status:** ${exported ? "⚠️ EXPORTED" : "📝 DRAFT — not exported (awaiting human review)"}`);
lines.push("");
lines.push("**Babou tool calls**");
lines.push("");
lines.push("```");
lines.push(sequence || "(none)");
lines.push("```");
lines.push("");
lines.push("_Export is deliberately a human action in the Babou dashboard._");

console.log(lines.join("\n"));
