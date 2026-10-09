# Error Handling: energy-report

> v0.1 · 2026-10-09 · Covers how failures are classified, raised, logged and shown.
> The summary in `CLAUDE.md` is binding. This document has the detail and the code registry.

## 1. Two kinds of problems

| Kind | Examples | Mechanism | Run continues? | Visible as |
|---|---|---|---|---|
| **Fatal** | Bad args, file missing or unreadable (or not a regular file) or too large, no valid records, invalid env, bugs | `throw new AppError(...)` | No: exit 1, stdout empty | stderr `✖ [CODE] message` and `logs/error.log` |
| **Data finding** | Malformed line, conflicting duplicate, clock anomaly, gap, unknown energy, invalid power | Returned as a report event or counter | Yes | `events`, `duplicates_dropped`, `invalid_power_readings` in the output |

Rule of thumb: if a correct report can still be produced, it's a data finding. Never throw for data.

## 2. Components

| Piece | File | Role |
|---|---|---|
| `ErrorDefinition` | `src/types/errors.ts` | `{ code, message }` |
| `ErrorModule` | `src/types/errors.ts` | Union of owning modules. Extend it when adding a module. |
| Dictionaries | `src/errors/modules/<module>.errors.ts` | `as const satisfies Record<string, ErrorDefinition>` |
| `AppError` | `src/errors/app-error.ts` | The **only** class ever thrown. `code`, `module`, `details`, `cause`, `isOperational`. |
| `ErrorHandler` | `src/errors/error-handler.ts` | Singleton `errorHandler.handle(error): never` |
| `runCommand` | `src/cli/run-command.ts` | The single `try/catch`. Validates env, times the run, funnels throws. |
| `errorLogger` | `src/logger/error-logger.ts` | `logs/error.log`. Only `ErrorHandler` may call it. |

## 3. Flow

1. Code throws `new AppError({ module, definition: XErrors.KEY, details?, cause? })`.
2. `runCommand` catches it. A non-`Error` throw becomes `SYS-001` (narrowed with `instanceof`; the
   `unknown` keyword is never written).
3. `errorHandler.handle(e)`: a non-`AppError` `Error` is wrapped as `SYS-000` with the original as
   `cause`.
4. `errorLogger.error({ code, module, message, details, cause, stack })` writes one JSON line.
5. stderr gets `\n✖ [CODE] <dictionary message>\n`. It is always the dictionary message, never a
   raw `Error.message`, which may contain system paths.
6. `process.exit(1)`. stdout is untouched because the report is written only after the whole
   pipeline succeeds.

Exit codes: `0` on success, `1` on any failure (`EXIT_CODE.FAILURE` in `constants.ts`).

## 4. Code registry

| Code | Key | File | Message (stderr) | Raised when | Status |
|---|---|---|---|---|---|
| SYS-000 | `UNEXPECTED` | `system.errors.ts` | An unexpected error occurred. See logs/error.log for details. | A non-AppError `Error` reaches the handler | Implemented |
| SYS-001 | `NON_ERROR_THROWN` | `system.errors.ts` | An unexpected non-error value was thrown. See logs/error.log for details. | Something other than an `Error` is thrown | Implemented |
| CFG-001 | `INVALID_ENV` | `config.errors.ts` | Invalid environment configuration (check NODE_ENV and LOG_LEVEL). | `parseEnv` fails. `details.invalid` lists field names, never values. | Implemented |
| CLI-001 | `MISSING_INPUT_PATH` | `cli.errors.ts` | Missing input file. Usage: npm start -- <file.jsonl> | No positional argument | Implemented |
| CLI-002 | `INVALID_ARGUMENTS` | `cli.errors.ts` | Unexpected arguments. Usage: npm start -- <file.jsonl> | Extra positional or any option (`parseArgs` strict error as `cause`) | Implemented |
| TEL-001 | `INPUT_NOT_FOUND` | `telemetry.errors.ts` | Input file not found. | `ENOENT` from realpath, stat or read | Implemented |
| TEL-002 | `INPUT_UNREADABLE` | `telemetry.errors.ts` | Input file could not be read. | Not a regular file (`details.reason: not_a_regular_file`), `EACCES`, `EPERM`, `ELOOP`, other fs errors (`details.reason` = the fs code) | Implemented |
| TEL-003 | `INPUT_TOO_LARGE` | `telemetry.errors.ts` | Input file exceeds the maximum supported size. | `size > MAX_INPUT_BYTES` | Implemented |
| TEL-004 | `NO_VALID_RECORDS` | `telemetry.errors.ts` | Input file contains no valid telemetry records. | Zero records accepted | Implemented |
| RPT-… | none yet | `report.errors.ts` | n/a | Add only if a report invariant can genuinely fail | n/a |

Prefixes: `SYS-` system, `CFG-` config, `CLI-` cli, `TEL-` telemetry, `RPT-` report. Codes are
never reused or renumbered. `CLI-003` (path outside `input/`) was retired on 2026-10-09, when the
user removed the `input/` confinement (`architecture.md` D-14). Don't reuse it.

## 5. What goes in `details` and `cause`

- `details` holds scalars only (`string | number | boolean`), e.g. `{ reason: 'ENOENT' }`,
  `{ invalid: 'LOG_LEVEL' }`, `{ line: 12 }`. Never the input path. `details` only reach
  `logs/error.log`, never stderr.
- **Never** include telemetry record contents (PII), env values or secrets.
- Node `fs` errors go in as `cause`. The error log records `cause.message` and the stack, which may
  contain paths. That is acceptable in the local log file, never on stdout.
- Do not put `SyntaxError.message` from `JSON.parse` anywhere: V8 quotes the offending input. Malformed
  lines are data findings with a fixed `reason`: `invalid_json`, `schema`, `unknown_meter`,
  `unit_id_mismatch`, `function_code`, `qty_mismatch`, `invalid_ts`, `address_window` or `model_id`.

`logs/error.log` line (illustrative):
```json
{"code":"TEL-001","module":"TELEMETRY","message":"Input file not found.","details":{"reason":"ENOENT"},"cause":"ENOENT: no such file or directory, realpath '…'","stack":"Error: ENOENT…","time":"2026-10-09T10:00:00.000Z","level":"error"}
```

## 6. Rules

- Only throw `new AppError(...)` built from a dictionary entry. Never throw a raw `Error`, a string
  or an object literal.
- One `try/catch` per command, in `runCommand`. Other `try/catch` blocks are allowed only to
  **translate** a boundary failure:
  - `JSON.parse` failure becomes a `malformed_record` event;
  - an `fs` error becomes `TEL-00x` with `cause`.
- In `catch (e)`, narrow immediately with `instanceof` and don't let `e` escape the block.
- Never swallow an error silently. The only exception is the logger's own write failure, which
  warns once on stderr (logging must not break the report).
- Never write to stdout from error paths.

## 7. Adding an error

1. Pick the module's dictionary, or create `src/errors/modules/<module>.errors.ts` and add the module
   to `ErrorModule`.
2. Add `KEY: { code: '<PFX>-<next number>', message: '<user-facing, no paths>' }`.
3. Throw it with `new AppError({ module, definition, details })`.
4. Add a test that triggers it (each dictionary entry is exercised at least once).
5. Add a row to §4 here and update the RTM.

## 8. Testing requirements

- `AppError` construction. `ErrorHandler.handle` with `process.exit` and `stderr` mocked: correct
  code on stderr, exit 1, no raw message leaked.
- `runCommand`: success doesn't exit; a thrown `AppError` and a non-Error throw both funnel to the
  handler.
- Integration: each CLI failure path gives an empty stdout, `✖ [CODE]` on stderr, and exit 1.
- Already covered for the infrastructure in `tests/unit/infra.test.ts`.
