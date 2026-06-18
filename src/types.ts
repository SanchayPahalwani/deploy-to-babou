/**
 * Shared types for the deploy -> draft-campaign pipeline.
 *
 * A "campaign" in Babou is a video Project (Project -> Chapters -> Prompts -> Export).
 * Babou has no "campaign" object and no "draft" flag, so a DRAFT here is structural:
 * create the Project + Chapters + Prompts and deliberately never call Export.
 */

/** Everything we know about a deploy, assembled from git / the GitHub event. */
export interface DeployContext {
  product: { name: string; tagline?: string };
  repo: string; // owner/name
  sha: string; // full commit sha
  shortSha: string;
  ref: string; // e.g. refs/heads/main
  version?: string; // package.json version at this deploy
  pr?: { number: number; title: string; body: string };
  commit: { subject: string; body: string };
  changedFiles: string[];
  diffStat: string;
  changelog?: string; // the CHANGELOG "Unreleased" block, if present
}

export interface ChapterPlan {
  name: string;
  duration: number; // seconds
  prompt: string; // the content submitted to Babou's AddPrompt
}

export interface CampaignPlan {
  project: { name: string; description: string };
  chapters: ChapterPlan[];
  /** Marker embedded in the project description so re-runs are idempotent. */
  idempotencyKey: string;
}

export interface BabouProject {
  id: string;
  name?: string;
  description?: string;
}

/** An ordered record of every Babou tool call we made. The contract we assert in CI. */
export type CallRecord =
  | { tool: "ListProjects"; args: Record<string, never> }
  | { tool: "CreateProject"; args: { name: string; description: string } }
  | { tool: "AddChapter"; args: { projectId: string; name: string; duration: number } }
  | { tool: "AddPrompt"; args: { projectId: string; chapterId: string; content: string } };

export interface DraftResult {
  status: "created" | "exists";
  projectId: string;
  chapters: { id: string; name: string }[];
  /** Always false. This pipeline cannot publish; that is a human action. */
  exported: false;
  idempotencyKey: string;
  calls: CallRecord[];
}
