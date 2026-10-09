# energy-report

## Project overview

`energy-report` is a TypeScript CLI (Node 20+) that reads Modbus telemetry for three PM-3 energy
meters (M1, M2, M3) from `input/telemetry.jsonl` and writes a daily per-meter energy report as JSON
to stdout. It has one command: `npm start -- telemetry.jsonl > output.json`. It reports local days
2026-10-24, 2026-10-25 and 2026-10-26 (Europe/Berlin): energy per day, interval count, peak power and
its time, plus `events` (every gap, plus every other anomaly that affects the numbers),
`duplicates_dropped`, and `invalid_power_readings`. No database, no network.
The spec lives in `.claude/docs/TASK.md`, and the vendor register map in `.claude/docs/register-map.md`.
Never edit the data files in `input/`.

## Docs (`.claude/docs/`)

Read the docs relevant to a change before planning it, and update them (and the RTM) in the same
change.

| Doc                                   | What it holds                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `TASK.md`                             | The brief. Authoritative. Never edit.                                                  |
| `register-map.md`                     | Vendor register map, verbatim from the take-home zip. Never edit.                      |
| `register-map-analysis.md`            | Address mapping, decoding, data-verified facts, conflicts (C-…), expected numbers      |
| `billing-statement.txt`               | Utility total for 2026-10-24, used for verification only.                              |
| `srs.md`                              | Requirements (FR-/NFR- ids), input schema, output spec, assumptions and open questions |
| `business-rules.md`                   | Domain rules BR-01…BR-18 (intervals, DST, gaps, never-invent, peak, events)            |
| `user-stories.md`                     | Personas and US-01…US-11 with acceptance criteria                                      |
| `architecture.md`                     | Modules, dependency rules, pipeline, key types, time algorithm, decisions (D-…)        |
| `error-handling.md`                   | Fatal errors vs data findings, flow, code registry                                     |
| `security-rules.md`                   | Threat model, controls, security-reviewer checklist, accepted risks                    |
| `coding-standards.md`                 | Conventions: naming, purity, numbers, time, constants, comments                        |
| `testing-standards.md`                | Jest layout, required unit and integration cases, acceptance numbers, coverage         |
| `requirements-traceability-matrix.md` | FR/NFR → rule → story → module → tests → status                                        |

## Commands

```
npm install                          # npm is silenced in this repo (see .npmrc); add --loglevel=notice to see npm output
npm start -- telemetry.jsonl         # builds, then runs the CLI; report JSON on stdout
npm run dev -- telemetry.jsonl       # same as start
npm run build                        # tsc -> dist/
npm run typecheck                    # tsc --noEmit (src + tests)
npm run lint                         # eslint (type-checked rules)
npm test                             # build + all jest tests with coverage
npm run test:unit                    # jest tests/unit
npm run test:integration             # build + jest tests/integration
npm run format                       # prettier --write .
```

The input path can be any file on the filesystem (user decision, 2026-10-09). It is resolved
against the cwd first; if that doesn't exist, against `input/`. So `telemetry.jsonl`,
`input/telemetry.jsonl` and an absolute path all work.
`.npmrc` sets `loglevel=silent` because otherwise npm prints its `> pkg script` banner to stdout,
which corrupts `output.json`.

## Tech stack

- TypeScript 5.9 (strict), CommonJS output, Node >= 20 (`.nvmrc`)
- CLI parsing: `node:util` `parseArgs` (stdlib, no framework)
- Validation: `zod` (env and telemetry records)
- Logging: own JSON-lines file writer (`src/logger/logger.ts`, no pino)
- Tests: `jest` + `ts-jest`
- Lint/format: `eslint` + `typescript-eslint` (strictTypeChecked), `prettier`
- Dependency versions are pinned exactly in `package.json`. New dependencies need user approval.

## Folder structure

```
src/
  cli/              # entrypoint (index.ts) + run-command.ts (the shared try/catch every command uses)
  config/
    index.ts        # re-exports env + constants
    env.ts          # the ONLY reader of process.env; zod-validated, typed Env
    constants.ts    # paths, exit codes, fixed limits, site/report constants — no magic values elsewhere
  errors/
    app-error.ts    # AppError, the only error class thrown
    error-handler.ts# ErrorHandler singleton: logs, prints `✖ [CODE] msg` to stderr, exits 1
    modules/        # one <module>.errors.ts dictionary per module (system, config, cli, telemetry, report)
  logger/
    logger.ts       # createLogger + appLogger (logs/app.log)
    error-logger.ts # errorLogger (logs/error.log), used ONLY by ErrorHandler
  telemetry/        # read, validate and decode input records (feature module)
  report/           # intervals, daily aggregation, events, output shape (feature module)
  types/            # shared interfaces/types only, no logic
  utils/            # small pure helpers (e.g. time zone conversion)
tests/
  setup-env.ts      # sets LOG_LEVEL=silent for test runs
  unit/             # pure functions, errors, logger, env
  integration/      # spawns the built CLI, asserts stdout/stderr/exit code
logs/               # app.log, error.log (git-ignored, created on demand)
.claude/
  agents/           # developer, quality-checker, tester, security-reviewer
  commands/build.md # /build: the pipeline below
  plans/            # one plan per change (see Planning)
  docs/             # spec docs (TASK.md, register-map.md, billing-statement.txt)
```

One module = one folder under `src/` plus its own `src/errors/modules/<module>.errors.ts`.

## Type safety rules

`tsconfig.json` sets `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch` (and `noImplicitReturns`).

ESLint bans these. Lint fails on them:

- `any`: never (`@typescript-eslint/no-explicit-any`). Use a concrete interface, a union or a generic.
- `unknown`: never written as a working type (`no-restricted-syntax` on `TSUnknownKeyword`).
- `object`, `Object`, `Function`, bare `{}`: use a named interface or a specific function signature.
  (`no-restricted-syntax` on `TSObjectKeyword`, `no-wrapper-object-types`, `no-unsafe-function-type`,
  `no-empty-object-type`. These replace `ban-types`, which typescript-eslint v8 removed.)
- `as any` and `as unknown as X` double-casts are forbidden. Fix the upstream type instead.
- Every function has an explicit return type (`explicit-function-return-type`).

**The one allowed exception:** `catch` variables and library boundary values are implicitly
`unknown`/`any`. Narrow them immediately, in the same block, before the value reaches other code:
use `instanceof` (e.g. `e instanceof AppError`) or a zod `.safeParse()`. For example,
`JSON.parse(line)` goes straight into `Schema.safeParse(...)`. A boundary value must never be assigned
to a variable with a wider scope than that narrowing block.

Every CLI option, config, file payload and error context gets an explicit `interface`/`type` in
`src/types/`.

## Error handling

- **Dictionaries:** each module owns a read-only dictionary in `src/errors/modules/<module>.errors.ts`:
  ```ts
  export const ConfigErrors = {
    INVALID_ENV: { code: 'CFG-001', message: 'Invalid environment configuration (...)' },
  } as const satisfies Record<string, ErrorDefinition>;
  ```
  Code prefixes: `SYS-` system, `CFG-` config, `CLI-` cli, `TEL-` telemetry, `RPT-` report. Add new
  codes to the right file. Never invent ad hoc errors. Add each new module name to `ErrorModule` in
  `src/types/errors.ts`.
- **`AppError` is the only error class thrown.** No file throws a raw `Error`, a string or an object
  literal. Always use `new AppError({ module, definition, details?, cause? })`, built from a dictionary
  entry. `details` holds only scalars and never contains telemetry record contents (PII). Line
  numbers and field names are fine.
- **`ErrorHandler`** (singleton, `errorHandler`): `handle(error)` wraps a non-AppError as `SYS-000`.
  It logs code, module, message, details, cause and stack to `logs/error.log`, prints
  `✖ [CODE] message` to stderr (the dictionary message only, never a raw message, which may contain
  system paths), and exits 1.
- **`runCommand(name, body)`** in `src/cli/run-command.ts` is the single try/catch. Every command body
  runs inside it. It validates env first, logs start/finish and timing, and sends any throw to
  `errorHandler.handle` (a non-Error throw becomes `SYS-001`). Don't repeat try/catch in commands.
- **Not errors:** malformed or anomalous telemetry records are skipped and reported in the output
  `events`. They are data findings, not failures.

## Logging

- `appLogger` writes to `logs/app.log`: command start and finish, `durationMs`, and key decisions.
  Never raw errors.
- `errorLogger` writes to `logs/error.log` and is called ONLY by `ErrorHandler`.
- Both write structured JSON lines (one object per line: `time`, `level`, `msg`, fields).
- The `logs/` directory is created on first write and is git-ignored. A logging failure never breaks
  the report: it warns once on stderr and continues.
- Level comes from `LOG_LEVEL` (`debug|info|warn|error|silent`, default `info`). Tests run with
  `silent`.
- Never log secrets, env contents or telemetry record contents.

## Comments

Comments describe the code, minimally. **All context lives in `CLAUDE.md` or `.claude/docs/`,
never in code.** Context means why, background, decisions, policies, known limits and history.

**JSDoc, point by point:**

1. Required on every exported function, class, public or static method, and constructor that takes
   parameters. On exported types, interfaces and constants, add one only when the name and type don't
   already say what it is.
2. Use a `/** … */` block. The first line is one present-tense sentence saying what the code does
   ("Parses…", "Returns…"), ending with a period.
3. `@param name - description`: one per parameter, in signature order, with the name matching
   exactly. No `{type}`; TypeScript supplies types.
4. `@returns description`: required unless the return type is `void` or `never`.
5. `@throws {AppError} CODE when <condition>`: one line for each AppError code raised in the
   function's own module that can escape it.
6. No other tags (`@example`, `@see`, `@todo`, `@author`, `@since`, …).
7. The summary and the tag text state behaviour only. No rationale, rule or requirement ids, policy
   reminders or doc references.

**Inline comments:**

8. Add a `//` comment only when a line's behaviour isn't evident from the code itself. Keep it to one
   line saying what the code does.
9. Never put these in code: why or background, decisions, policy reminders ("never call X"), rule or
   requirement ids, `TODO`/`FIXME`, `ponytail:` markers, history, references to tickets, chats or AI,
   commented-out code, or banner/divider comments.
10. Exception: the `-- reason` that must follow an `eslint-disable-next-line` directive, in a few
    words.
11. These rules apply to `src/`, `tests/` and config files (`*.mjs`, `.npmrc`, ignore files). Test
    titles (`it('…')`) are not comments and may cite rule ids.

**Where context goes instead:**

- Binding rules → this file.
- Design, decisions and deliberate shortcuts with their limits → `architecture.md` §9–10.
- Domain rules → `business-rules.md`.
- Accepted risks → `security-rules.md` §5.
- Per-change rationale → `.claude/plans/`.

```ts
/**
 * Runs a command body after validating the environment, logging its timing and handling any throw.
 * @param command - Command name written to the app log.
 * @param body - Command implementation.
 */
export function runCommand(command: string, body: () => void): void {
```

## Planning

Before implementing any change, write a short plan to `.claude/plans/<slug>.md`:

- what will change and why
- which files/modules are touched
- how it fits the pipeline below

Only start coding once the plan file exists. Keep plan files — don't delete them after merging;
they're a record of why a change was made. The `developer` agent enforces this as its first step.

## Agents & pipeline

The main thread orchestrates and does not write feature code itself. Every change runs in this
fixed order and stops at the first failure:

1. **developer** checks that a plan exists in `.claude/plans/`, then implements the change.
2. **quality-checker** runs `npm run typecheck` and `npm run lint`, and greps the diff for banned
   types. On failure, send it back to developer with the exact violations. Do not proceed.
3. **tester** writes and runs unit and integration tests (Jest). On failure, send it back to
   developer. Do not proceed.
4. **security-reviewer** audits the diff, runs `npm audit`, and confirms no commit was made. On a
   high-severity finding or a commit attempt, stop and surface it to the user.
5. Report to the user what changed and the test results, and say it is ready for manual review and
   commit.

`/build <change>` (`.claude/commands/build.md`) runs this pipeline. Follow the same order even when
`/build` isn't invoked. Agent definitions live in `.claude/agents/`. If they aren't loaded as agent
types yet (new files only load on session start), run each step as a general-purpose agent seeded
with that agent file's instructions.

## Security & commit policy

**Claude never runs `git commit` or `git push`. The user reviews and commits manually.**

- Enforced by tooling: `.claude/settings.json` denies `git commit`, `git commit --amend` and
  `git push`.
- Enforced by agent: `security-reviewer` checks on every run that no commit happened and that the
  diff is left for the user to inspect.
- Every run checks for: hardcoded secrets/keys/tokens, unsanitized input reaching
  `exec`/`eval`/shell, an input path read without first being resolved with `path.resolve` and
  passing the regular-file and size checks (the path is user-supplied and may point anywhere), and
  high/critical findings from `npm audit` (reported, never silently ignored).
- Config and secrets live only in `.env` (git-ignored), are loaded only through `src/config/env.ts`,
  and are never logged.
- `logs/` is the one write path besides stdout/stderr. It was explicitly requested in the
  architecture prompt (`.claude/prompts/initial-architechture-prompt.md`).

## Security Rules (non-negotiable)

### Secrets & credentials

- Never hardcode secrets, API keys, tokens, passwords, or connection strings. Use environment variables via `process.env`; validate they are present at startup.
- Never commit `.env` files. Ensure `.env` is in `.gitignore`.

### Input validation (trust boundary: the JSONL file and CLI args)

- Validate every field read from `input/telemetry.jsonl` against its expected type and shape before use. Reject or skip malformed records — never coerce silently.
- Validate CLI arguments (file paths, flags) before use. Reject invalid values with a clear message to stderr and a non-zero exit code.
- Never call `JSON.parse` on untrusted input without a `try/catch` that handles `SyntaxError`.

### Path traversal & file system

- The input path is user-supplied and may point anywhere on the filesystem (user decision, 2026-10-09; replaces `input/` confinement). Resolve it with `path.resolve()` and follow symlinks with `realpath`. Read it only after checking that it is a regular file within `MAX_INPUT_BYTES`.
- Never put the input path in a stderr message or in error `details`.
- Never construct file paths by concatenating user-supplied strings directly.

### Command injection

- Never spawn child processes with `shell: true` or interpolate user-controlled strings into shell commands (`exec`, `execSync`, shell-mode `spawn`).
- Prefer `spawn`/`spawnSync` with an explicit args array over `exec` string form.

### Dynamic code execution

- Never use `eval()`, `new Function()`, or `vm.runInNewContext()` with user-supplied input.

### TypeScript type safety

- `strict: true` must be set in `tsconfig.json`. Never use `// @ts-ignore` or `// @ts-expect-error` in security-sensitive paths.
- Avoid `as any` casts on data from external sources (files, CLI args). Parse into typed shapes explicitly.

### Error handling & information disclosure

- Catch all errors; write a user-friendly message to stderr. Never let raw stack traces or system paths reach stdout.
- Do not log the full content of telemetry records in error messages — they may contain PII.

### Dependencies

- Do not add new npm dependencies without explicit user approval.
- When a dependency is needed, pin an exact version and run `npm audit` before committing.

### Prototype pollution (JS/TS)

- Guard against `__proto__`, `constructor`, and `prototype` keys when merging or spreading untrusted objects.
- Use `Object.create(null)` for lookup maps populated from external data.

### Principle of least privilege

- Only access paths the tool genuinely needs: the one input file named on the command line for reads, stdout/stderr (and `logs/`) for writes. Do not open, read, or write other paths unless explicitly requested.
