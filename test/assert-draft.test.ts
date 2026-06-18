import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Runs the real assert-draft.ts against a crafted call log and returns its exit
// code, so the draft invariant (and the idempotent-no-op exception) is locked in.
const SCRIPT = fileURLToPath(new URL("../scripts/assert-draft.ts", import.meta.url));

function runAssert(logLines: object[], plan?: object): number {
  const dir = mkdtempSync(join(tmpdir(), "assert-draft-"));
  try {
    const logPath = join(dir, "calls.jsonl");
    writeFileSync(logPath, logLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const env: NodeJS.ProcessEnv = { ...process.env, BABOU_MOCK_LOG: logPath };
    delete env.BABOU_API_KEY;
    if (plan) {
      const planPath = join(dir, "plan.json");
      writeFileSync(planPath, JSON.stringify(plan));
      env.BABOU_PLAN = planPath;
    } else {
      env.BABOU_PLAN = join(dir, "absent.json");
    }
    execFileSync("npx", ["tsx", SCRIPT], { env, encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const call = (tool: string, args: Record<string, unknown> = {}) => ({ tool, args });
const fullDraft = [
  call("ListProjects"),
  call("CreateProject"),
  call("AddChapter"),
  call("AddPrompt"),
  call("AddChapter"),
  call("AddPrompt"),
  call("AddChapter"),
  call("AddPrompt"),
];

describe("assert-draft script", () => {
  it("passes a well-formed new draft", () => {
    expect(runAssert(fullDraft)).toBe(0);
  }, 30_000);

  it("FAILS if ExportProject ever appears", () => {
    expect(runAssert([...fullDraft, call("ExportProject")])).toBe(1);
  }, 30_000);

  it("FAILS on force:true", () => {
    expect(runAssert([call("ListProjects"), call("CreateProject"), call("AddChapter"), call("AddPrompt", { force: true })])).toBe(1);
  }, 30_000);

  it("passes an idempotent no-op inferred from the log (only ListProjects)", () => {
    expect(runAssert([call("ListProjects")])).toBe(0);
  }, 30_000);

  it("passes an idempotent no-op signalled by plan.json status=exists", () => {
    expect(runAssert([call("ListProjects")], { status: "exists", projectId: "prj_existing" })).toBe(0);
  }, 30_000);
});
