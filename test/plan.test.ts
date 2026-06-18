import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCampaignPlan, deriveIdempotencyKey, matchesDeploy } from "../src/plan.js";
import type { DeployContext } from "../src/types.js";

const ctx = JSON.parse(readFileSync(new URL("../fixtures/sample-deploy.json", import.meta.url), "utf8")) as DeployContext;

describe("buildCampaignPlan", () => {
  it("is deterministic and matches the snapshot", () => {
    expect(buildCampaignPlan(ctx)).toMatchSnapshot();
  });

  it("produces three timed chapters, each with a substantial prompt", () => {
    const plan = buildCampaignPlan(ctx);
    expect(plan.chapters).toHaveLength(3);
    for (const c of plan.chapters) {
      expect(c.duration).toBeGreaterThan(0);
      expect(c.prompt.length).toBeGreaterThan(20);
    }
  });

  it("embeds the idempotency marker in the project description", () => {
    const plan = buildCampaignPlan(ctx);
    const key = deriveIdempotencyKey(ctx);
    expect(key).toBe(`shipcast:sha=${ctx.sha}`);
    expect(plan.project.description).toContain(key);
    expect(matchesDeploy(plan.project.description, key)).toBe(true);
  });
});
