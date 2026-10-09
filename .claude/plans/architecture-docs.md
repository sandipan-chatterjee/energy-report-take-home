# Plan — fill architecture/context docs in .claude/docs/

## What & why

User asked to fill all architecture-related docs, which are empty. They become the standing context
for future sessions and subagents (CLAUDE.md links to them), so feature work in step D has written
rules to implement and test against.

## Files

- Fill (currently empty): `srs.md`, `business-rules.md`, `architecture.md`, `coding-standards.md`,
  `error-handling.md`, `security-rules.md`, `testing-standards.md`, `user-stories.md`.
- Fill: `requirements-traceability-matrix.md` (user emptied the old template from an unrelated app);
  maps this project's FR/NFR ids to rules, stories, modules and tests.
- Untouched: `register-map.md` (vendor spec, user supplies it), `TASK.md`, `billing-statement.txt`.
- `CLAUDE.md`: add a short "Docs" index. `developer` agent: read the relevant docs.

## Sources

TASK.md, CLAUDE.md, the architecture prompt, the data profile of input/telemetry.jsonl, and the
infra already built. Anything that needs the register map is marked **TBD (register-map.md)**,
never invented.

## Pipeline fit

Docs only, no code. The pipeline (developer → quality-checker → tester → security-reviewer) applies
to step D, which these docs feed.
