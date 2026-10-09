# Coding Standards: energy-report

> v0.1 · 2026-10-09 · How code in this repo is written. The type-safety, error and logging rules in
> `CLAUDE.md` are binding. This document expands on them and adds conventions.
> Enforced by `npm run typecheck`, `npm run lint`, prettier (hook and `npm run format`) and the
> quality-checker agent.

## 1. TypeScript

- Compiler flags: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitReturns`,
  `isolatedModules`.
- Banned: `any`, the `unknown` keyword, `object`, `Object`, `Function`, `{}`, `as any`,
  `as unknown as X`, `@ts-ignore`, `@ts-expect-error`.
- **Boundary rule:** values that arrive untyped are narrowed in the same block. That covers
  `catch (e)`, `JSON.parse` and `process.env`. Use `instanceof` or a zod `.safeParse()`. Example:
  `const r = RecordSchema.safeParse(JSON.parse(line))` inside `try`.
- Every function has an explicit return type. Callbacks passed inline are exempt
  (`allowExpressions`).
- Optional property under `exactOptionalPropertyTypes`: write `prop: T | undefined` when the value
  may be explicitly `undefined`. Write `prop?: T` only when the key may be absent.
- Prefer `readonly` fields and `readonly T[]` for anything not mutated.
- Use type-only imports for types: `import type { Reading } from '../types/telemetry'`.
- No non-null assertions (`!`). Handle `undefined` from indexed access explicitly.

## 2. Naming and files

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `read-input.ts`, `error-handler.ts` |
| Error dictionaries | `<module>.errors.ts`, export `<Module>Errors` | `telemetry.errors.ts` / `TelemetryErrors` |
| Tests | `tests/{unit,integration}/<subject>.test.ts` | `tests/unit/time.test.ts` |
| Types, interfaces | PascalCase, no `I` prefix | `Reading`, `DailyRow` |
| Functions, variables | camelCase, verb-first for functions | `resolveInstant`, `buildReport` |
| Constants | SCREAMING_SNAKE_CASE | `GAP_THRESHOLD_SECONDS` |
| Output JSON fields | snake_case exactly as the brief | `energy_kwh`, `peak_at` |

One module equals one folder under `src/`. Keep the file count low: merge small related functions
into one file rather than making one file per function.

## 3. Imports and dependencies

- Use the `node:` prefix for built-ins (`node:fs`, `node:path`, `node:util`).
- Use relative imports. `src/config/index.ts` is the only barrel; don't add more.
- Respect the module dependency rules in `architecture.md` §3. In particular, `report/` and
  `utils/` never import `node:fs` or `logger/`.
- New npm packages need explicit user approval, an exact pin and `npm audit` (`CLAUDE.md`).

## 4. Functions and data flow

- Prefer **pure functions**: input in, new value out, no hidden state. Side effects live only in
  `cli/`, `telemetry/read-input.ts`, `logger/` and `errors/error-handler.ts`.
- Never mutate parameters. Return new arrays and objects. Sort a copy (`[...xs].sort(...)` or
  `toSorted`).
- Keep functions short and single-purpose, and name them after the rule they implement.
  Code-to-rule traceability lives in the RTM's module column, not in comments.
- Classes only where they add something: `AppError` (instanceof) and `ErrorHandler` (singleton).
  Everything else is functions and plain data.
- Don't build abstractions for one caller: no interface with a single implementation, no factory
  for one product, no config for values that never change.

## 5. Numbers

- Register values are integers 0–65535. Combine multi-register values with integer arithmetic. Check
  `Number.isSafeInteger` on the combined result.
- Apply scale factors **after** computing differences where possible, and keep full precision until
  output.
- Round **once**, in `report/format.ts`: energy to 2 decimals, power to 1 (BR-14). Never round
  intermediate sums.
- Never compare floats with `===`. Compare raw integers, or use the rounded output.
- Use `Map<MeterId, …>` for aggregation keyed by meter or date, not plain objects keyed by external
  strings.

## 6. Dates and time

- **All** time-zone logic lives in `src/utils/time.ts` (`architecture.md` §6). Its functions take the
  zone as a parameter; callers pass `SITE_TIMEZONE`.
- Instants are epoch-ms numbers. Local dates are `YYYY-MM-DD` strings.
- Never call `new Date('YYYY-MM-DD HH:mm:ss')` (implementation-defined parse). Never use local
  getters (`getHours`, `getDate`, `toLocaleString` without `timeZone`). Results must not depend on
  the host time zone (NFR-DET-01).
- Never use `Date.now()` or `new Date()` in report logic: output must not depend on the current
  time. Logging timestamps are the only exception.
- Durations are instant differences in seconds, never wall-clock differences.

## 7. Constants (no magic values)

Anything reused, environment-dependent or meaningful beyond one line lives in
`src/config/constants.ts`. Planned names:
- `SITE_TIMEZONE`, `REPORT_DAYS`, `METERS`, `METER_UNIT_IDS`
- `GAP_THRESHOLD_SECONDS` (450), `MAX_INPUT_BYTES` (50 MiB)
- `ENERGY_DECIMALS` (2), `POWER_DECIMALS` (1)
- `MODBUS_FC_READ_HOLDING` (3), and the register addresses and sentinels listed in
  `register-map-analysis.md` §5 (power is used as read: C-02 decided (a), no scale constant)
- `paths`, `EXIT_CODE`

Literal `0`, `1`, `''` and array indexes in obvious local use don't need names.

## 8. Errors and logging

- Throw only `new AppError({ module, definition: XErrors.KEY, details })`. See
  `error-handling.md`.
- Data anomalies are report events, not throws.
- Command bodies run inside `runCommand`. Don't add other top-level `try/catch` blocks.
- Log notable events with `appLogger.info({ ...scalars }, 'message')`. Never call `errorLogger`
  directly. Never log record contents, env values or raw parser messages.

## 9. Comments and docs

- **The binding rules are in `CLAUDE.md` → "Comments".** In short:
  - JSDoc on every exported function, class, public or static method and constructor with
    parameters (types and constants only when the name doesn't say it), point by point: summary
    sentence, `@param` per parameter, `@returns` unless `void`/`never`, `@throws {AppError} CODE`
    per escaping module code, no other tags.
  - Inline `//` comments only for non-obvious behaviour, one line, describing what the code does.
  - No context in code: no why, decisions, policies, rule ids, TODOs or `ponytail:` markers.
- Context removed from or kept out of code goes in docs instead. Deliberate shortcuts and their
  limits go in `architecture.md` §9–10, accepted risks in `security-rules.md` §5.
- Update `CLAUDE.md`, the relevant `.claude/docs/*.md` and the RTM in the same change as the code
  (NFR-MAINT-03).

## 10. Formatting and lint

- Prettier: single quotes, `printWidth` 100, default everything else. A hook formats every edited
  file. `.claude/docs/`, `.claude/prompts/`, `input/` and `output/` are excluded: supplied data and
  spec documents must never be reformatted.
- ESLint `strictTypeChecked` plus the project rules must pass with zero warnings.
- `eslint-disable` is allowed only on a single line with a `--` justification, and **never** for
  type-safety rules in `src/`.

## 11. Git

Claude never commits or pushes; the user reviews and commits. Keep each change focused, with one
plan file in `.claude/plans/` per change.
