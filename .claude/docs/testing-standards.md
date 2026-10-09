# Testing Standards: energy-report

> v0.1 · 2026-10-09 · How the code is tested. The `tester` agent follows this. Requirements are
> traced to tests in `requirements-traceability-matrix.md`.

## 1. Tooling

- **Jest 30 + ts-jest**, `testEnvironment: node`, config in `jest.config.mjs`.
- `tests/setup-env.ts` sets `LOG_LEVEL=silent`, so test runs never write to `logs/`.
- Commands:
  - `npm test` (build, then all tests with coverage)
  - `npm run test:unit`
  - `npm run test:integration` (builds first)

## 2. Layout and naming

```
tests/
  setup-env.ts
  unit/<subject>.test.ts          # pure functions: time, parse, dedupe, intervals, aggregation, format, errors
  integration/cli.test.ts         # spawns the built CLI (dist/cli/index.js)
```

- `describe` names the unit, and `it` states the behaviour and cites the rule, e.g.
  `it('attributes a 23:55→00:00 interval to the start day (BR-07)')`.
- One behaviour per test. Arrange the data inline: build telemetry lines in memory with a small
  helper in the test file.

## 3. Unit tests (required)

| Area | Must cover |
|---|---|
| Errors and infra | `AppError` fields. `ErrorHandler.handle` (exit and stderr mocked, code printed, raw message not leaked). `runCommand` success, AppError and non-Error paths. `parseEnv` defaults and invalid input. Logger level filtering. *(Done: `tests/unit/infra.test.ts`)* |
| Every error dictionary entry | Each code triggered at least once (unit or integration) |
| `utils/time` | Normal +02:00 and +01:00 conversion. Both 02:30 instants on 2026-10-25. Nonexistent spring-forward time. ISO formatting with offset. Local date at midnight boundaries. |
| Parsing | Valid line. Invalid JSON. Each schema violation (`regs` non-integer or out of range, `qty` mismatch, unknown meter, `unit_id` mismatch, `fc` ≠ 3, bad `ts`). Blank lines. CRLF. Extra keys ignored. A `__proto__` key doesn't pollute. Line numbers in events. |
| De-duplication and order | Identical duplicates dropped and counted. Conflicting duplicate gives an event and the first is kept. Shuffled input gives the same result. |
| Register decode | uint32 and float32 decoded low word first. Negative int16 SF (`0xFFFF` → −1). Lookup by address with `start_addr` 99 and 100. Power `0x7FC00000` → invalid. Other NaN/Infinity → invalid. Model ID ≠ `0x1F4A` → malformed. Window missing PDU 100–106 → malformed. |
| Intervals and energy | Counter delta × 10^SF for SF 0, 1 and −1. Day attribution at 23:55→00:00. Gap at 451 s but not at 450 s. Gap energy counted versus not. Rollover (`0xFFFFFFE0` → `47`) counted, with a `counter_rollover` event. Restart (`uptime_end < interval seconds`) gives 0 and `power_loss`. Non-rollover decrease gives 0 and `counter_decrease`. SF change gives 0 and `scale_factor_change`. |
| Peak power | Max per day. Tie goes to the earliest. Invalid excluded and counted. No valid value gives `null`. |
| Formatting | Rounding (2 dp and 1 dp, once). Key order. 9 rows sorted. Event ordering. |
| `fw_msg` | Changing `fw_msg` (including the M2 scale-factor message) leaves all numbers unchanged (BR-13). |

## 4. Integration tests (required)

Spawn `node dist/cli/index.js` with `spawnSync(process.execPath, [script, ...args])`, an args
array, never a shell. Assert stdout, stderr and the exit code.

| Case | Expect |
|---|---|
| `telemetry.jsonl` and `input/telemetry.jsonl` | Exit 0. stdout parses as JSON and matches the §5 checks. stderr has no `✖`. |
| No argument | Exit 1, `[CLI-001]`, empty stdout |
| Extra argument or `--flag` | Exit 1, `[CLI-002]`, empty stdout |
| Absolute path to a temp copy of `input/telemetry.jsonl` outside the repo (`mkdtempSync`) | Exit 0, stdout byte-identical to the `input/telemetry.jsonl` run |
| A directory (e.g. the temp dir) | Exit 1, `[TEL-002]`, empty stdout |
| Missing file (`missing.jsonl`) | Exit 1, `[TEL-001]`, empty stdout |
| Any failure | stderr never contains the input path |
| `LOG_LEVEL=loud` | Exit 1, `[CFG-001]`, empty stdout |
| Same input with `TZ=UTC`, `TZ=Asia/Kolkata`, `TZ=America/New_York` | Byte-identical stdout (NFR-DET-01) |
| `npm start -- telemetry.jsonl` through npm | stdout is pure JSON with no npm banner (US-07). Run once; it's slow. |

Pass `LOG_LEVEL=silent` in the child env, except in the `CFG-001` case.

## 5. Acceptance checks on the supplied data

These come from the 2026-10-09 data profile. A mismatch means a bug, or a data fact we hadn't
understood. Investigate; don't adjust the expectation to match.

| Check | Expected |
|---|---|
| `daily` rows | 9: dates 24/25/26 × M1/M2/M3, in that order |
| `intervals` | 10-24: M1 **283**, M2 288, M3 288 · 10-25: **300** each · 10-26: M1 288, M2 288, M3 **280** |
| `gap` events | Exactly 2: M1 `2026-10-24T15:00:00+02:00`→`15:30:00+02:00` with `energy_counted: true`; M3 `2026-10-26T10:40:02+01:00`→`11:25:02+01:00` with `energy_counted: false` and `reason: power_loss` |
| `counter_rollover` events | Exactly 1: M2 `2026-10-25T04:40:01+01:00`→`04:45:01+01:00` |
| `duplicates_dropped` | 37 |
| `invalid_power_readings` | 3 |
| `malformed_record`, `clock_anomaly`, `duplicate_conflict`, `energy_unknown` | 0 each |
| `energy_kwh` | 10-24: M1 913.45, M2 541.20, M3 250.92 · 10-25: 945.35, 552.29, 253.93 · 10-26: 910.66, 539.11, 238.01 |
| `peak_at` | As in `register-map-analysis.md` §6. M1 on 10-25 is `2026-10-25T02:35:00+01:00`, the second pass of the DST hour. |
| `peak_power_w` | `register-map-analysis.md` §6, raw column (C-02 decided (a): no ×3) |
| Billing (BR-18) | Σ `energy_kwh` (M1+M2+M3, 2026-10-24) ∈ [1703.89, 1707.31]. Expected 1,705.57 from the rounded rows. |

## 6. Rules

- **Never weaken or delete a failing test to make it pass.** Fix the code, or flag the test to the
  user.
- Never write into `input/` (the data files are read-only). Path cases that need a real file copy it
  into a temp dir.
- Temporary files go only under `os.tmpdir()` (`mkdtempSync`).
- No network. No shell strings (`exec`, `shell: true`).
- Deterministic: no assertions on wall-clock time and no reliance on host TZ or locale.
- Mock `process.exit` and `process.stderr.write` with `jest.spyOn` and restore them in `afterEach`.
- Tests use the same type rules as `src/`. A justified single-line `eslint-disable` is allowed when
  a test deliberately exercises a forbidden pattern (e.g. throwing a non-Error).
- The AppError-only throw rule covers `src/`. Test doubles may throw a test-local `Error` subclass,
  e.g. `class ExitCalled extends Error {}` to stop at a mocked `process.exit`.

## 7. Coverage

- `npm test` prints coverage (`collectCoverageFrom: src/**/*.ts`).
- Target: **≥ 90 % lines and branches** for `src/telemetry`, `src/report` and `src/utils`, and
  every error dictionary entry exercised.
- Once the feature lands, enforce it with `coverageThreshold` in `jest.config.mjs`. It isn't
  enforced yet because those modules don't exist.
