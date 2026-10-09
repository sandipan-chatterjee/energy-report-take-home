# Claude Code Build Prompt — TypeScript CLI Tool

This is a ready-to-paste prompt for **Claude Code**. Open a Claude Code session inside the repository that contains `TASK.md` (the actual CLI tool project — not this chat), paste this document as your first message, and let Claude Code execute it top to bottom. It is not a one-off instruction: once built, this becomes the standing contract for the project — every future session should keep following the architecture, type rules, error/logging system, and agent pipeline defined below.

## 1. Pre-flight — read the task first

Before writing any code:

1. Read `task.md` at the repo root in full. It is the authoritative spec for what this CLI tool does — its commands, inputs/outputs, and success criteria.
2. Restate the tool's purpose, primary commands, and in-scope/out-of-scope behavior in your own words before touching any file.
3. If `task.md` is missing, ambiguous, or conflicts with anything in this document, stop and ask rather than guessing.
4. Check what's already in the repo (`package.json`, `.nvmrc`, existing `src/`) so you extend existing conventions instead of starting two parallel setups.

Only move to section 2 once the task is clear.

## 2. Architecture context doc (`CLAUDE.md`)

Create or update `CLAUDE.md` at the repo root. This is the file Claude Code auto-loads into context every session, so it is the project's single source of truth — not documentation nobody reads. Fill in the specifics from `task.md`, and keep every rule below in it verbatim so future sessions (including subagents) inherit them automatically.

Required sections:

- **Project overview** — one paragraph: what the CLI does, its name, primary commands (filled from `task.md`).
- **Commands** — exact scripts: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:unit`, `npm run test:integration`, how to run the CLI locally (e.g. `npm run dev -- <command>`).
- **Tech stack** — TypeScript (strict), Node.js version, CLI framework (e.g. `commander`), test runner (e.g. `vitest`), logger (e.g. `pino`), schema validation (e.g. `zod`).
- **Folder structure** — the tree from section 3, with one line per folder saying what belongs there.
- **Type safety rules** — the full rule set from section 4.
- **Error handling** — the full system from section 5: where error dictionaries live, how `AppError` and `ErrorHandler` are used, the rule that every thrown error in the codebase must be an `AppError`.
- **Logging** — the full system from section 6.
- **Agents & pipeline** — the subagents from section 7 and the pipeline order from section 8, so the main thread always delegates the same way.
- **Security & commit policy** — the rule from section 9, stated plainly: *Claude never runs `git commit` or `git push`. The user reviews and commits manually.*

Treat `CLAUDE.md` as living: when you add a module, a new error dictionary, or change a convention, update it in the same change.

## 3. Project structure, config & constants

Scaffold this layout (extend it, don't flatten it):

```
src/
  cli/              # command definitions + entrypoint
  config/
    index.ts        # re-exports env + constants
    env.ts           # loads & validates process.env (zod schema, typed output)
    constants.ts     # paths, app name/version, fixed limits
  errors/
    app-error.ts     # base AppError class
    error-handler.ts # ErrorHandler manager (singleton)
    modules/
      cli.errors.ts
      config.errors.ts
      <module>.errors.ts   # one file per module
  logger/
    logger.ts        # app-event logger
    error-logger.ts  # error logger (writes error.log)
  types/              # shared interfaces, no module logic
  utils/
logs/
  app.log
  error.log
task.md
CLAUDE.md
.claude/
  agents/
  commands/
  settings.json
```

Rules:

- **No magic values.** Any literal that is reused, environment-dependent, or has meaning beyond one line (file paths, limits, default flags, exit codes, URLs) is named and lives in `config/constants.ts` or `config/env.ts` — never hardcoded inline in command or business logic.
- **Config is typed and validated at startup**, not read ad hoc. `env.ts` parses `process.env` once through a schema and exports a fully typed object; nothing else in the codebase reads `process.env` directly.
- **One module = one folder under `src/`** (e.g. `src/commands/sync/`). Each module gets its own error dictionary file under `errors/modules/`.

## 4. Strict TypeScript rules

`tsconfig.json` must set: `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noFallthroughCasesInSwitch: true`.

Banned, enforced by ESLint (`@typescript-eslint/no-explicit-any`, `@typescript-eslint/ban-types`, a `no-restricted-syntax` rule for the `unknown` keyword):

- `any` — never. Use a concrete interface, a union, or a generic.
- `unknown` — not used as a working type anywhere in business logic. Every value gets a real shape.
- `object`, `Object`, `Function`, bare `{}` — too loose to mean anything; use a named interface or a specific function signature instead.
- `as any` / `as unknown as X` double-casts — forbidden; if a cast feels necessary, fix the upstream type instead.

**The one allowed exception:** TypeScript types `catch` clause variables as `unknown` by default, and third-party libraries sometimes return `unknown`/`any` at a boundary. In both cases, narrow immediately — within the same function, before the value touches any other code — using a type guard (`isAppError(e)`) or a `zod` schema's `.parse()`/`.safeParse()`, which takes an untyped boundary value and returns a fully typed result. `unknown` must never be reassigned to a variable with a wider scope than that narrowing block.

All CLI command options, config, API/file payloads, and error contexts get explicit `interface`/`type` declarations in `src/types/`. A function's return type is always written explicitly, never inferred-and-hoped.

## 5. Error handling system

**Module-wise error dictionaries.** Each module owns a typed, read-only dictionary of its error definitions under `errors/modules/<module>.errors.ts`:

```ts
// errors/modules/cli.errors.ts
export interface ErrorDefinition {
  readonly code: string;
  readonly message: string;
}

export const CliErrors = {
  INVALID_COMMAND: { code: 'CLI-001', message: 'Invalid command provided.' },
  MISSING_ARGUMENT: { code: 'CLI-002', message: 'A required argument is missing.' },
} as const satisfies Record<string, ErrorDefinition>;
```

Each module uses its own code prefix (`CLI-`, `CFG-`, `SYS-`, …) so codes are unique and traceable at a glance.

**`AppError` — the only error class thrown.** It extends `Error`:

```ts
// errors/app-error.ts
export interface AppErrorOptions {
  readonly module: string;
  readonly definition: ErrorDefinition;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly cause?: Error;
}

export class AppError extends Error {
  readonly code: string;
  readonly module: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly isOperational = true;

  constructor(options: AppErrorOptions) {
    super(options.definition.message);
    this.name = 'AppError';
    this.code = options.definition.code;
    this.module = options.module;
    this.details = options.details;
    if (options.cause) this.cause = options.cause;
  }
}
```

No file ever throws a raw `Error`, a string, or an object literal — only `new AppError({ module, definition, details })` built from a module's dictionary.

**`ErrorHandler` — the manager.** A singleton every command funnels into:

```ts
// errors/error-handler.ts
export class ErrorHandler {
  private static instance: ErrorHandler;
  private constructor() {}
  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) ErrorHandler.instance = new ErrorHandler();
    return ErrorHandler.instance;
  }

  handle(error: AppError | Error): never {
    const appError = error instanceof AppError ? error : this.wrap(error);
    errorLogger.error({ code: appError.code, module: appError.module, message: appError.message, details: appError.details, stack: appError.stack });
    process.stderr.write(`\n✖ [${appError.code}] ${appError.message}\n`);
    process.exit(1);
  }

  private wrap(error: Error): AppError {
    return new AppError({ module: 'SYSTEM', definition: { code: 'SYS-000', message: error.message || 'Unexpected error.' }, cause: error });
  }
}

export const errorHandler = ErrorHandler.getInstance();
```

Every CLI command's top-level handler wraps its body in `try { … } catch (e) { errorHandler.handle(e instanceof AppError ? e : errorHandler['wrap'](e as Error)); }` (or a shared `runCommand()` wrapper that does this once, which every command should use instead of repeating the try/catch).

**`logs/error.log`.** The error logger (section 6) is configured to write structured JSON lines to `logs/error.log` on every `ErrorHandler.handle()` call, in addition to the short message printed to the CLI.

## 6. Logging system

A second, separate concern from error handling: **app-event logging** — what the CLI is doing, not just what broke. Use `pino` (or an equivalent structured logger) with two independent sinks:

```ts
// logger/logger.ts — app events
import pino from 'pino';
import { paths } from '../config/constants';

export const appLogger = pino({ level: 'info' }, pino.destination(paths.appLogFile)); // logs/app.log
```

```ts
// logger/error-logger.ts — errors only, used by ErrorHandler
import pino from 'pino';
import { paths } from '../config/constants';

export const errorLogger = pino({ level: 'error' }, pino.destination(paths.errorLogFile)); // logs/error.log
```

Rules:

- `appLogger` records command starts/completions, key decisions, and timing (e.g. `appLogger.info({ command: 'sync', durationMs })`) — never raw errors.
- `errorLogger` is written to **only** by `ErrorHandler`, never called directly from command code — that keeps all error logging going through one funnel.
- Both logs are structured JSON lines (one object per line), so they're greppable and parseable later.
- `logs/` is created on startup if missing, and is git-ignored.

## 7. Subagents

Create four subagent files under `.claude/agents/`. Each is a Markdown file with YAML frontmatter (`name`, `description`, `tools`) followed by its system prompt.

**`.claude/agents/developer.md`**

```
---
name: developer
description: Implements CLI features and fixes per CLAUDE.md. Use for all code-writing tasks.
tools: Read, Write, Edit, Grep, Glob, Bash
---
You implement features for this CLI tool. Before writing code, read CLAUDE.md and task.md.
Follow the type-safety rules exactly (no any/unknown/open types). Every thrown error must be
an AppError built from a module error dictionary — add new codes to the right
errors/modules/*.errors.ts file rather than inventing ad hoc errors. Use appLogger for
notable events. Never run `git commit` or `git push`. When done, report what changed and hand
off to the quality-checker.
```

**`.claude/agents/quality-checker.md`**

```
---
name: quality-checker
description: Runs type checking and lint/code-quality checks. Use after any code change, before tests.
tools: Bash, Read, Grep
---
Run `npm run typecheck` and `npm run lint`. Also grep the diff for `any`, `unknown` (outside an
approved narrowing block), `as any`, bare `object`/`Function`/`{}`. Report every violation with
file:line — do not silently fix unless asked. Pass/fail verdict at the end.
```

**`.claude/agents/tester.md`**

```
---
name: tester
description: Writes and runs tests. Use after quality-checker passes, before security review.
tools: Read, Write, Edit, Bash, Grep, Glob
---
Write tests for the changed code, covering:
- Unit tests: pure functions, AppError construction, each error-dictionary entry used at least
  once, ErrorHandler.handle() behavior (mock process.exit/stderr).
- Integration tests: CLI commands run end-to-end (spawn the built CLI or call its command
  handler directly) asserting stdout/stderr/exit code, including at least one failure path per
  command that exercises the error-handling flow.
- Edge cases: missing/invalid args, config/env validation failures.
Use the project's test runner (e.g. vitest). Run the full suite and report pass/fail with
coverage. Never weaken or delete a failing test to make it pass — fix the code or flag it.
```

**`.claude/agents/security-reviewer.md`**

```
---
name: security-reviewer
description: Security and commit-policy audit. Use as the last step of every pipeline run, before handing back to the user.
tools: Bash, Read, Grep
---
Check the diff for: hardcoded secrets/API keys/tokens, unsafe shell execution (exec/eval with
unsanitized input), unsafe file-path handling (path traversal), and run `npm audit` for
vulnerable dependencies. Confirm no git commit or push was made in this session — that is
forbidden; the user commits manually. Report findings; block the pipeline from being reported
'done' if any high-severity issue or an uncommitted-but-attempted commit is found.
```

## 8. Orchestration pipeline

The main Claude Code thread acts as orchestrator — it does not write code itself once agents exist; it delegates in a fixed order and stops the pipeline on the first failure:

1. **developer** implements the change.
2. **quality-checker** runs typecheck + lint. Fail → back to developer with the exact violations; do not proceed.
3. **tester** writes/runs unit + integration tests. Fail → back to developer; do not proceed.
4. **security-reviewer** audits the diff and confirms no commit was made. Fail (high severity, or a commit attempt found) → stop and surface it to the user; do not proceed.
5. Report to the user: what changed, test results, and that it's ready for manual review and commit.

Encode this as a slash command so it's invoked consistently: `.claude/commands/build.md`

```
---
description: Run the full implement → quality-check → test → security-review pipeline for one change.
---
Implement the following using the pipeline in CLAUDE.md section 8 (developer → quality-checker →
tester → security-reviewer, stopping on first failure): $ARGUMENTS
```

Document this exact sequence in `CLAUDE.md` section "Agents & pipeline" so it's followed even when a session doesn't explicitly invoke `/build`.

## 9. Security & commit policy

**Hard rule: Claude never commits or pushes.** The user reviews every diff and commits manually. Enforce this two ways, not just by asking nicely:

1. **Tooling-level block** — `.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git commit --amend:*)"
    ]
  }
}
```

2. **Agent-level check** — `security-reviewer` (section 7) verifies, every pipeline run ("every spin"), that no commit happened and that the diff is left staged/unstaged for the user to inspect.

Other standing security checks for `security-reviewer`, every run:

- No hardcoded secrets, API keys, tokens, or credentials anywhere in source (grep for common patterns; flag anything that looks like a key).
- No unsanitized input passed to `exec`/`eval`/shell calls.
- No unvalidated file paths that could escape the project directory.
- `npm audit` run, high/critical vulnerabilities reported, not silently ignored.
- Config/secrets live in `.env` (git-ignored) and are loaded only through `config/env.ts` — never committed, never logged (including by `appLogger`/`errorLogger`).

## 10. Execution instructions

When Claude Code receives this document as a prompt, do the following in order, in a single setup pass:

1. Run section 1 (pre-flight) — read `task.md`, confirm scope.
2. Scaffold the structure in section 3 (folders, `tsconfig.json`, ESLint config per section 4, `package.json` scripts).
3. Build the error-handling system (section 5) and logging system (section 6) exactly as specified — these are infrastructure every later feature depends on.
4. Write `CLAUDE.md` (section 2), filling the overview/commands from `task.md` and copying the standing rules (sections 4–9) into it verbatim so future sessions inherit them.
5. Create the four subagent files (section 7) and the `/build` command + `.claude/settings.json` (sections 8–9).
6. Only after infrastructure is in place, implement the CLI's actual commands from `task.md` — and from this point on, **every feature goes through the section 8 pipeline** (developer → quality-checker → tester → security-reviewer), never written directly by the main thread.
7. Stop before any commit. Summarize what was built and wait for manual review.
