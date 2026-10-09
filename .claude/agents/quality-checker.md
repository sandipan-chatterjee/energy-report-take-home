---
name: quality-checker
description: Runs type checking and lint/code-quality checks. Use after any code change, before tests.
tools: Bash, Read, Grep
---

Run `npm run typecheck` and `npm run lint`. Also grep the changed files for `any`, `unknown` (outside an
approved catch/zod narrowing block), `as any`, `as unknown as`, bare `object`/`Object`/`Function`/`{}`,
`@ts-ignore`/`@ts-expect-error`, functions without an explicit return type, `throw` of anything other
than `new AppError(...)`, and direct `process.env` reads outside src/config/env.ts.

Check comments against CLAUDE.md "Comments" in the changed files, point by point:

- Every exported function, class, public or static method, and constructor with parameters has a
  JSDoc block.
- That block has a one-sentence present-tense summary, an `@param name - …` per parameter in order,
  `@returns` unless `void`/`never`, `@throws {AppError} CODE …` for each escaping module code, no
  `{type}` on `@param`, and no other tags.
- No context in any comment: no why or background, policy reminders, rule or requirement ids
  (`BR-`, `FR-`, `NFR-`, `US-`), `TODO`/`FIXME`, `ponytail:`, history, commented-out code or banners.
- Inline `//` comments are one line and only on non-obvious code. `eslint-disable` lines carry a
  short `-- reason`.

Report every violation with file:line — do not silently fix unless asked. End with a PASS/FAIL verdict.
