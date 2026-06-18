# deploy-to-babou

**Every merge drafts a [Babou](https://babou.ai) launch campaign — agentically, through Babou's own MCP server. Export stays a human's call.**

When you merge to `main`, a GitHub Action turns the deploy (PR, commit, diff, changelog) into a **draft** Babou video campaign: it creates a Project, adds three chapters (_What shipped_ / _Why it matters_ / _Try it_), and writes a prompt for each — then deliberately **stops before Export**, leaving a draft in the dashboard for a human to review and publish.

The integration is an **agent**, not a hand-written API client: a headless `claude -p` reads the deploy context and drives Babou's MCP tools itself. And the whole thing is **verifiable with zero credentials** before any key exists — a bundled mock MCP server lets a real agent run offline, and a CI check proves the draft was never exported.

> Built as a work sample for Babou. It dogfoods the idea: this repo's own deploys draft this repo's launch campaign.

---

## Quickstart (no credentials needed)

```bash
npm install
npm run verify     # typecheck + tests + offline draft + draft-invariant assertion
```

`verify` is green on a fresh clone with **no API keys**. It runs the deterministic pipeline against an in-memory mock and asserts the exact Babou call shape (and that `ExportProject` was never called).

### See a real agent draft a campaign (needs only an Anthropic key)

```bash
npm run smoke:mcp   # prove the mock MCP server speaks MCP over stdio (5 tools)
npm run agent       # a real `claude -p` agent drafts the campaign via the mock MCP server
npm run assert      # verify the agent's actual calls satisfy the draft invariant
```

No **Babou** key required — the agent talks to the local mock. With `ANTHROPIC_API_KEY` (or a logged-in Claude Code), the agent genuinely chooses the chapter structure and writes the copy.

---

## How it works

```
merge to main
   └─ GitHub Action (action.yml)
        ├─ scripts/build-context.ts   PR + commit + diff + CHANGELOG  →  CONTEXT.md
        ├─ the agent (claude -p)       drives Babou MCP tools:
        │     ListProjects → CreateProject → AddChapter ×3 → AddPrompt ×3
        │     (ExportProject is NOT allow-listed — uncallable)
        └─ scripts/assert-draft.ts     fails CI if anything was exported
```

### The mock → live flip is one config change

The agent's only difference between dry-run and live is **which MCP server it points at**:

| Mode | Needs | MCP target | Proves |
| --- | --- | --- | --- |
| **REPLAY** (CI default) | nothing | in-memory mock (`run-rest.ts`) | the call contract, offline |
| **AGENT vs MOCK** | a Claude credential (below) | local mock MCP (stdio) | the **agent** really drafts it — no Babou key |
| **LIVE** | + `BABOU_API_KEY` | `https://api.babou.ai/mcp` (http) | a real `prj_…` draft in Babou's dashboard |

To go live, set the repo secrets (a Claude credential + `BABOU_API_KEY`). The Action then routes to the live MCP server automatically.

### Auth & cost — who can run it, what it bills

The agent needs one Claude credential, set as a **repo secret**. Two options, in precedence order:

| Secret | Bills | Get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | metered **API** credits | console.anthropic.com |
| `CLAUDE_CODE_OAUTH_TOKEN` | your **Claude subscription** (Pro/Max) | `claude setup-token` (1-yr token) |

Set **either** (if both are set, the API key wins). The subscription token is the cheaper choice — a merge draws on your flat-rate plan instead of API credits. Locally, no secret is needed at all: `npm run agent` uses your logged-in Claude Code.

**Can a stranger run up my bill? No.** This workflow triggers only on `push` to `main` and `workflow_dispatch` — never `pull_request`/`pull_request_target`. Fork pull requests [don't receive repo secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions#using-secrets-in-a-workflow) and don't trigger those events, and `workflow_dispatch` requires **write access**. So only you (and collaborators you grant write access) can trigger a run that uses the key. For a hard ceiling regardless, set a spend limit on the key (or use the subscription token) and prefer a dedicated key you can rotate.

### "Draft" = create everything, never Export

Babou has no draft flag; the unit is a video Project (Project → Chapters → Prompts → Export). So a draft here is **structural**: build the Project + Chapters + Prompts and never call `ExportProject`. This matches Babou's own documented _Review & Refine_ step before Export. The invariant is enforced three ways:

1. `ExportProject` is omitted from the agent's `--allowedTools` (uncallable in headless `-p`) and listed in `--disallowedTools`.
2. The agent's system prompt forbids it.
3. `scripts/assert-draft.ts` fails CI if `ExportProject` appears in the call log. This covers the credential-free mock/replay paths; in **live** mode the real MCP server writes no local log, so export prevention there rests on layers 1–2.

---

## Layout

| Path | What |
| --- | --- |
| `src/plan.ts` | Pure, deterministic deploy → campaign plan (snapshot-tested). |
| `src/transport.ts` | `RestTransport` (real REST, retry/backoff) + `MockTransport` (deterministic). |
| `src/orchestrator.ts` | The draft pipeline; idempotent; never exports. |
| `agent/mock-babou-mcp.ts` | Local MCP server mirroring Babou's tools — the credential-free stand-in. |
| `agent/system-prompt.md` | The agent's guardrails. |
| `scripts/run-agent.ts` | Launches the headless agent (mock or live). |
| `scripts/assert-draft.ts` | The machine-checkable definition of a correct draft. |
| `action.yml` + `.github/workflows/` | The composite Action and the deploy trigger. |

## Idempotency

Each project description embeds `shipcast:sha=<commit>`. Before drafting, the pipeline (and the agent) `ListProjects` and skip if a campaign for this exact deploy already exists — so re-merges and re-runs don't pile up duplicates.

## Verified against

Babou's live docs (`docs.babou.ai`): REST base `https://api.babou.ai/api/v1`, `Bearer sk-bab-…` auth, and the MCP tools `CreateProject` / `ListProjects` / `AddChapter` / `AddPrompt` / `ExportProject`. Nothing here invents an endpoint or field beyond that surface.
