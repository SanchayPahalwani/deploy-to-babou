# Changelog

All notable changes to this project are documented here. The **Unreleased**
block is read by the pipeline and fed into the campaign draft — so this file is
both a changelog and the marketing source of truth.

## [Unreleased]

### Added

- Agentic merge → draft pipeline: a headless Claude Code agent drives Babou's
  MCP tools (`ListProjects → CreateProject → AddChapter → AddPrompt`) to draft a
  three-chapter launch campaign from the deploy context.
- Mock Babou MCP server so the full contract — and a real agent run — are
  verifiable with **zero credentials**.
- Never-export draft invariant, enforced in CI by `assert-draft`.
- Idempotent re-runs: a re-deploy of the same commit is a verified no-op, never a
  duplicate campaign (matched by a `shipcast:sha=<commit>` marker).

## [0.1.0] - 2026-06-18

- Initial release.
