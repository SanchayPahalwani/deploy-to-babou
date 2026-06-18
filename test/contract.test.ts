import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDraftCampaign } from "../src/orchestrator.js";
import { MockTransport } from "../src/transport.js";
import type { DeployContext } from "../src/types.js";

const ctx = JSON.parse(readFileSync(new URL("../fixtures/sample-deploy.json", import.meta.url), "utf8")) as DeployContext;

describe("draft contract", () => {
  it("creates a draft with the exact Babou call sequence and never exports", async () => {
    const t = new MockTransport();
    const result = await runDraftCampaign(ctx, t);

    const sequence = t.getCalls().map((c) => c.tool);
    expect(sequence).toEqual([
      "ListProjects",
      "CreateProject",
      "AddChapter",
      "AddPrompt",
      "AddChapter",
      "AddPrompt",
      "AddChapter",
      "AddPrompt",
    ]);
    expect(sequence).not.toContain("ExportProject");
    expect(result.exported).toBe(false);
    expect(result.status).toBe("created");
    expect(result.projectId).toMatch(/^prj_/);
  });

  it("is idempotent: a re-run for the same deploy creates nothing new", async () => {
    const key = `shipcast:sha=${ctx.sha}`;
    const t = new MockTransport([{ id: "prj_existing", description: `prior draft ${key} pending review` }]);
    const result = await runDraftCampaign(ctx, t);

    expect(result.status).toBe("exists");
    expect(result.projectId).toBe("prj_existing");
    // Only the read happened — no writes.
    expect(t.getCalls().map((c) => c.tool)).toEqual(["ListProjects"]);
  });

  it("call bodies match Babou's documented REST shapes", async () => {
    const t = new MockTransport();
    await runDraftCampaign(ctx, t);
    const calls = t.getCalls();

    const create = calls.find((c) => c.tool === "CreateProject")!;
    expect(create.args).toMatchObject({ name: expect.any(String), description: expect.any(String) });

    const chapter = calls.find((c) => c.tool === "AddChapter")!;
    expect(chapter.args).toMatchObject({ name: expect.any(String), duration: expect.any(Number) });

    const prompt = calls.find((c) => c.tool === "AddPrompt")!;
    expect(prompt.args).toMatchObject({ content: expect.any(String) });
  });
});
