# Plan — commenting rule

## What & why

User rule: comments follow JSDoc point by point and stay minimal and code-specific. All context
(why, background, decisions, policies, limits) lives in CLAUDE.md or `.claude/docs/`, never in code.

## Files

- Docs (main thread):
  - `CLAUDE.md`: new binding "Comments" section.
  - `coding-standards.md` §4 and §9: drop "cite rule ids in comments" and `ponytail:` markers.
  - `architecture.md` D-04: absorb the logger ceiling note currently in code.
  - `developer.md` and `quality-checker.md`: apply and check the rule.
- Code (developer agent): rewrite comments in `src/`, `tests/`, `eslint.config.mjs`,
  `jest.config.mjs`, `.npmrc` and `.prettierignore` to the rule. Add the required JSDoc to exported
  functions, classes and methods. No behaviour change.

## Pipeline fit

developer → quality-checker → tester (suite only; behaviour unchanged) → security-reviewer.
