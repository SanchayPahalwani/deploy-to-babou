/**
 * Assemble the deploy context from data already on the runner: the merged-PR
 * title/body (via gh), the merge commit, the diff between the previous and
 * current sha, the CHANGELOG "Unreleased" block, and the package version.
 *
 * Works both in GitHub Actions (reads GITHUB_* env + the event payload) and
 * locally (falls back to plain git). Writes context.json (for the REST path)
 * and CONTEXT.md (the human/agent-readable brief).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { DeployContext } from "../src/types.js";

const ZERO = "0000000000000000000000000000000000000000";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const repo =
  process.env.GITHUB_REPOSITORY ||
  sh("git config --get remote.origin.url")
    .replace(/^.*github\.com[:/]/, "")
    .replace(/\.git$/, "") ||
  "local/repo";

const sha = process.env.GITHUB_SHA || sh("git rev-parse HEAD") || ZERO;
const shortSha = sha.slice(0, 7);
const ref = process.env.GITHUB_REF || sh("git rev-parse --abbrev-ref HEAD") || "refs/heads/main";

const subject = sh("git log -1 --format=%s");
const commitBody = sh("git log -1 --format=%b");

// Diff range: prefer the GitHub push event's `before` sha; else last commit.
let before = "";
const eventPath = process.env.GITHUB_EVENT_PATH;
if (eventPath && existsSync(eventPath)) {
  try {
    before = (JSON.parse(readFileSync(eventPath, "utf8"))?.before as string) || "";
  } catch {
    /* ignore */
  }
}
// Choose a diff source: the push event's previous sha, else the parent commit,
// else (root commit / first push) the commit itself against the empty tree.
let nameCmd: string;
let statCmd: string;
if (before && before !== ZERO) {
  nameCmd = `git diff --name-only ${before} ${sha}`;
  statCmd = `git diff --stat ${before} ${sha}`;
} else if (sh("git rev-parse --verify -q HEAD~1")) {
  nameCmd = "git diff --name-only HEAD~1 HEAD";
  statCmd = "git diff --stat HEAD~1 HEAD";
} else {
  nameCmd = "git diff-tree --root --no-commit-id --name-only -r HEAD";
  statCmd = "git diff-tree --root --no-commit-id --stat -r HEAD";
}
const changedFiles = sh(nameCmd).split("\n").filter(Boolean);
const diffStat = sh(statCmd);

// package.json version + identity.
let version: string | undefined;
let pkgName = "app";
let pkgDesc = "";
if (existsSync("package.json")) {
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    version = pkg.version;
    pkgName = pkg.name || pkgName;
    pkgDesc = pkg.description || "";
  } catch {
    /* malformed/partial package.json — keep the defaults */
  }
}

// Merged-PR details (best effort, via gh). The merge commit subject usually
// carries "(#123)".
let pr: DeployContext["pr"];
const prNum = subject.match(/\(#(\d+)\)/)?.[1] || process.env.PR_NUMBER;
if (prNum) {
  const json = sh(`gh pr view ${prNum} --json number,title,body`);
  if (json) {
    try {
      const p = JSON.parse(json);
      pr = { number: p.number, title: p.title, body: p.body || "" };
    } catch {
      /* ignore */
    }
  }
}

// CHANGELOG "Unreleased" block — the highest-signal "what shipped" source.
let changelog: string | undefined;
if (existsSync("CHANGELOG.md")) {
  const md = readFileSync("CHANGELOG.md", "utf8");
  // Capture the Unreleased body up to the next "## " heading (matched at a line
  // start so an *empty* Unreleased block followed immediately by the next
  // release heading yields an empty capture, not the next version's notes).
  const block = md.match(/##\s*\[?Unreleased\]?[^\n]*\n([\s\S]*?)(?=\n?^##\s|$(?![\s\S]))/im)?.[1];
  if (block && block.trim()) changelog = block.trim();
}

const productName = process.env.PRODUCT_NAME || pkgName;
const productTagline = process.env.PRODUCT_TAGLINE || pkgDesc || undefined;

const ctx: DeployContext = {
  product: { name: productName, tagline: productTagline },
  repo,
  sha,
  shortSha,
  ref,
  version,
  pr,
  commit: { subject, body: commitBody },
  changedFiles,
  diffStat,
  changelog,
};

writeFileSync("context.json", JSON.stringify(ctx, null, 2));
writeFileSync("CONTEXT.md", renderMarkdown(ctx));
console.log(`Built deploy context for ${repo}@${shortSha} — ${changedFiles.length} files changed.`);

function renderMarkdown(c: DeployContext): string {
  return [
    `# Deploy context`,
    ``,
    `- **Product:** ${c.product.name}${c.product.tagline ? ` — ${c.product.tagline}` : ""}`,
    `- **Repo:** ${c.repo}@${c.shortSha} (${c.ref})`,
    `- **Version:** ${c.version ?? "n/a"}`,
    c.pr ? `\n## PR #${c.pr.number}: ${c.pr.title}\n\n${c.pr.body}` : "",
    `\n## Commit\n\n${c.commit.subject}${c.commit.body ? `\n\n${c.commit.body}` : ""}`,
    `\n## Changed files\n\n${c.changedFiles.map((f) => `- ${f}`).join("\n") || "(none)"}`,
    `\n## Diffstat\n\n\`\`\`\n${c.diffStat || "(none)"}\n\`\`\``,
    c.changelog ? `\n## Changelog (Unreleased)\n\n${c.changelog}` : "",
    ``,
  ].join("\n");
}
