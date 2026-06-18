/**
 * The draft pipeline: deploy context -> a Babou draft campaign.
 *
 * Steps mirror Babou's documented workflow (Create Project -> Add Chapters ->
 * Submit Prompts) and STOP at their "Review & Refine" step. We never call
 * Export — the draft sits in the dashboard for a human to publish.
 */
import { buildCampaignPlan, matchesDeploy } from "./plan.js";
import type { DraftTransport } from "./transport.js";
import type { DeployContext, DraftResult } from "./types.js";

export async function runDraftCampaign(ctx: DeployContext, transport: DraftTransport): Promise<DraftResult> {
  const plan = buildCampaignPlan(ctx);

  // Idempotency: if a campaign for this exact deploy already exists, no-op.
  const existing = (await transport.listProjects()).find((p) => matchesDeploy(p.description, plan.idempotencyKey));
  if (existing) {
    return {
      status: "exists",
      projectId: existing.id,
      chapters: [],
      exported: false,
      idempotencyKey: plan.idempotencyKey,
      calls: transport.getCalls(),
    };
  }

  const { id: projectId } = await transport.createProject(plan.project);

  const chapters: { id: string; name: string }[] = [];
  for (const ch of plan.chapters) {
    const { id: chapterId } = await transport.addChapter(projectId, { name: ch.name, duration: ch.duration });
    await transport.addPrompt(projectId, chapterId, { content: ch.prompt });
    chapters.push({ id: chapterId, name: ch.name });
  }

  // DRAFT: deliberately do NOT export. Publishing is a human decision.
  return {
    status: "created",
    projectId,
    chapters,
    exported: false,
    idempotencyKey: plan.idempotencyKey,
    calls: transport.getCalls(),
  };
}
