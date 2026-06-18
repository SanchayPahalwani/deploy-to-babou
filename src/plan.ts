/**
 * Pure, deterministic mapping from a deploy to a Babou campaign plan.
 *
 * No network, no side effects, no randomness -> snapshot-testable. The agent
 * path can deviate from this (it chooses its own structure), but this is the
 * golden reference and the deterministic fallback.
 */
import type { CampaignPlan, ChapterPlan, DeployContext } from "./types.js";

export const MARKER_PREFIX = "shipcast:sha=";

export function deriveIdempotencyKey(ctx: DeployContext): string {
  return `${MARKER_PREFIX}${ctx.sha}`;
}

/** Does an existing project's description belong to this exact deploy? */
export function matchesDeploy(description: string | undefined, key: string): boolean {
  return !!description && description.includes(key);
}

export function buildCampaignPlan(ctx: DeployContext): CampaignPlan {
  const key = deriveIdempotencyKey(ctx);
  const headline = (ctx.pr?.title || ctx.commit.subject || "Latest update").trim();
  const versionLabel = ctx.version ? `v${ctx.version}` : ctx.shortSha;
  const product = ctx.product.name;

  const projectName = `${product} — ${headline}`.slice(0, 80);
  const description = [
    `Auto-drafted launch campaign for ${product} ${versionLabel}.`,
    `Source: ${ctx.repo}@${ctx.shortSha}.`,
    `Status: DRAFT (not exported) — pending human review.`,
    key, // idempotency marker; ListProjects scans descriptions for this
  ].join(" ");

  const changed = summarizeChanges(ctx);

  // Babou best practice (from their docs): "anchor on the product surface" —
  // reference real release notes/UI, give explicit timing cues, and let the
  // brand catalog resolve colors/type instead of restating them.
  const chapters: ChapterPlan[] = [
    {
      name: "What shipped",
      duration: 20,
      prompt: lines([
        `20-second opener announcing what just shipped in ${product} ${versionLabel}.`,
        `0-3s: product logo resolves from the brand catalog.`,
        `3-15s: headline "${headline}" on screen with the key change.`,
        `Anchor on the product surface — pull real UI / release notes, not generic stock.`,
        changed && `Touched areas: ${changed}.`,
      ]),
    },
    {
      name: "Why it matters",
      duration: 30,
      prompt: lines([
        `30-second value beat: why this change matters to the user.`,
        `Translate the release into one concrete user benefit; one idea per 5-7s beat.`,
        ctx.changelog
          ? `Ground the benefit in the changelog: ${oneLine(ctx.changelog)}.`
          : `Ground the benefit in the PR description / commit body.`,
        `Resolve colors and typography from the brand catalog; keep copy tight.`,
      ]),
    },
    {
      name: "Try it",
      duration: 20,
      prompt: lines([
        `20-second close with a clear call to action for ${product}.`,
        `15-18s: CTA button styled to match the product's primary button.`,
        `End card: "${product}${ctx.product.tagline ? ` — ${ctx.product.tagline}` : ""}".`,
      ]),
    },
  ];

  return { project: { name: projectName, description }, chapters, idempotencyKey: key };
}

function summarizeChanges(ctx: DeployContext): string {
  if (!ctx.changedFiles.length) return "";
  const groups = new Map<string, number>();
  for (const f of ctx.changedFiles) {
    const top = f.includes("/") ? f.split("/")[0]! : f;
    groups.set(top, (groups.get(top) ?? 0) + 1);
  }
  return [...groups.entries()].map(([k, n]) => `${k} (${n})`).join(", ");
}

function lines(parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 200);
}
