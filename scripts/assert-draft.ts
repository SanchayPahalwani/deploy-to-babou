/**
 * The machine-checkable definition of "a correct draft".
 *
 * Reads the call log (mock-calls.jsonl) produced by either the agent (via the
 * mock MCP server) or REPLAY mode, and asserts the draft invariant:
 *   - exactly one CreateProject
 *   - at least one AddChapter, with one AddPrompt per chapter
 *   - ZERO ExportProject   <- the draft invariant
 *   - no force:true
 * Exits non-zero (failing CI) on any violation.
 */
import { existsSync, readFileSync } from "node:fs";

const LOG = process.env.BABOU_MOCK_LOG ?? "mock-calls.jsonl";

if (!existsSync(LOG)) {
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

if (creates !== 1) errors.push(`expected exactly 1 CreateProject, got ${creates}`);
if (chapters < 1) errors.push(`expected >= 1 AddChapter, got ${chapters}`);
if (prompts !== chapters) errors.push(`expected one AddPrompt per chapter (${chapters}), got ${prompts}`);
if (exports !== 0) errors.push(`DRAFT INVARIANT VIOLATED: ExportProject was called ${exports} time(s)`);
if (forced) errors.push("unexpected force:true on AddPrompt");

const sequence = calls.map((c) => c.tool).join(" -> ");

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
