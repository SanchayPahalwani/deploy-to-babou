/**
 * The machine-checkable definition of "a correct draft".
 *
 * Reads the call log (mock-calls.jsonl) produced by either the agent (via the
 * mock MCP server) or REPLAY mode, and asserts the draft invariant:
 *   - exactly one CreateProject
 *   - at least one AddChapter, with one AddPrompt per chapter
 *   - ZERO ExportProject   <- the draft invariant
 *   - no force:true
 * ...unless the run was an idempotent no-op (the campaign already existed, so
 * only ListProjects ran and nothing was written), in which case it asserts the
 * inverse — zero writes, zero export — and passes. Re-running must stay green.
 * Exits non-zero (failing CI) on any violation.
 */
import { existsSync, readFileSync } from "node:fs";

const LOG = process.env.BABOU_MOCK_LOG ?? "mock-calls.jsonl";
const PLAN = process.env.BABOU_PLAN ?? "plan.json";

if (!existsSync(LOG)) {
  // Live mode talks to the real HTTP MCP server, which does not write a local
  // call log. The log-based check covers the mock/replay paths; in live mode
  // ExportProject is prevented by the --allowedTools/--disallowedTools allowlist
  // and the system prompt (see run-agent.ts). Don't fail-closed here.
  if (process.env.BABOU_API_KEY) {
    console.log(
      "assert-draft: live HTTP MCP run — no local call log. Export is gated by the " +
        "allowlist + system prompt; the call-log invariant covers the mock/replay paths.",
    );
    process.exit(0);
  }
  console.error(`assert-draft: no call log found at ${LOG}. Did the draft step run?`);
  process.exit(2);
}

interface Call {
  tool: string;
  args?: Record<string, unknown>;
}

const calls: Call[] = readFileSync(LOG, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Call);

const count = (tool: string) => calls.filter((c) => c.tool === tool).length;

const errors: string[] = [];
const creates = count("CreateProject");
const chapters = count("AddChapter");
const prompts = count("AddPrompt");
const exports = count("ExportProject");
const forced = calls.some((c) => c.tool === "AddPrompt" && c.args?.force === true);

// Idempotent no-op: a campaign for this deploy already existed, so the run
// only read (ListProjects) and wrote nothing. This is a *success*, not a
// failure — re-running a draft must be a safe no-op. Recognize it from
// plan.json when present (REST/replay path), else infer it from the log
// (the agent path doesn't write plan.json): the only call is ListProjects.
const planStatus: string | undefined = existsSync(PLAN)
  ? (JSON.parse(readFileSync(PLAN, "utf8")) as { status?: string }).status
  : undefined;
const onlyListed = calls.length > 0 && creates === 0 && calls.every((c) => c.tool === "ListProjects");
const idempotentNoop = planStatus === "exists" || onlyListed;

const sequence = calls.map((c) => c.tool).join(" -> ");

if (idempotentNoop) {
  // Inverse invariant: a no-op must have touched nothing but the read.
  if (creates !== 0) errors.push(`idempotent no-op expected 0 CreateProject, got ${creates}`);
  if (chapters !== 0) errors.push(`idempotent no-op expected 0 AddChapter, got ${chapters}`);
  if (prompts !== 0) errors.push(`idempotent no-op expected 0 AddPrompt, got ${prompts}`);
  if (exports !== 0) errors.push(`DRAFT INVARIANT VIOLATED: ExportProject was called ${exports} time(s)`);

  if (errors.length) {
    console.error("❌ assert-draft FAILED (idempotent no-op):");
    for (const e of errors) console.error(`   - ${e}`);
    console.error(`   sequence: ${sequence}`);
    process.exit(1);
  }
  console.log("✅ assert-draft OK — idempotent no-op: campaign already existed, nothing created, 0 exports.");
  console.log(`   sequence: ${sequence}`);
  process.exit(0);
}

// A new draft was actually created: assert the full draft invariant.
if (creates !== 1) errors.push(`expected exactly 1 CreateProject, got ${creates}`);
if (chapters < 1) errors.push(`expected >= 1 AddChapter, got ${chapters}`);
if (prompts !== chapters) errors.push(`expected one AddPrompt per chapter (${chapters}), got ${prompts}`);
if (exports !== 0) errors.push(`DRAFT INVARIANT VIOLATED: ExportProject was called ${exports} time(s)`);
if (forced) errors.push("unexpected force:true on AddPrompt");

if (errors.length) {
  console.error("❌ assert-draft FAILED:");
  for (const e of errors) console.error(`   - ${e}`);
  console.error(`   sequence: ${sequence}`);
  process.exit(1);
}

console.log(
  `✅ assert-draft OK — draft verified: 1 project, ${chapters} chapters, ${prompts} prompts, 0 exports.`,
);
console.log(`   sequence: ${sequence}`);
