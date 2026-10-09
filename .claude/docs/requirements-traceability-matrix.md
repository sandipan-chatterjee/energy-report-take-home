# Requirements Traceability Matrix: energy-report

> v0.1 · 2026-10-09 · Maps every requirement in `srs.md` to its rule (`business-rules.md`), user
> story (`user-stories.md`), module and tests. Update the row **in the same change** that implements
> or tests it (NFR-MAINT-03). An unmapped requirement counts as not implemented.

**Status:** `Not Started` · `Blocked` (waiting on a user decision) · `In Progress` ·
`Implemented` · `Tested` · `Done` (= implemented + tested + passed quality-checker and
security-reviewer)

## Functional: CLI

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-CLI-01 | Exactly one positional arg (CLI-001/002) | n/a | US-07, US-08 | `cli/index.ts` | integration: no arg, extra arg, flag | Implemented |
| FR-CLI-02 | Resolve path (cwd, then `input/`) + realpath; any file, no confinement (user decision 2026-10-09) | n/a | US-08 | `cli/input-path.ts` | integration: absolute temp path outside the repo, directory (TEL-002), missing (TEL-001) | Implemented |
| FR-CLI-03 | Stdout only on success; `✖ [CODE]` + exit 1 on failure | n/a | US-07, US-08 | `cli/index.ts`, `cli/run-command.ts`, `errors/` | `unit/infra.test.ts` (handler, runCommand); integration: failure paths | Implemented |

## Functional: input

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-IN-01 | Read UTF-8; TEL-001/002/003 | n/a | US-08 | `telemetry/read-input.ts` | unit: size cap; integration: missing file | Implemented |
| FR-IN-02 | Guarded `JSON.parse` + schema; malformed gives an event | BR-16 | US-09 | `telemetry/parse.ts` | unit: parsing | Implemented |
| FR-IN-03 | Cross-field checks (qty, fc, meter, unit_id, address window) | BR-16 | US-09 | `telemetry/parse.ts` | unit: parsing | Implemented |
| FR-IN-04 | No accepted records gives TEL-004 | n/a | US-08 | `telemetry/parse.ts` | unit | Implemented |

## Functional: de-duplication and ordering

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-SEQ-01 | Drop identical duplicates, count them | BR-03 | US-06 | `telemetry/parse.ts` | unit: dedupe; acceptance: 37 | Implemented |
| FR-SEQ-02 | Conflicting duplicate: keep first + event | BR-03 | US-06 | `telemetry/parse.ts` | unit: dedupe | Implemented |
| FR-SEQ-03 | Process in `gw_seq` order | BR-02 | US-06 | `telemetry/parse.ts` | unit: shuffled input | Implemented |

## Functional: time

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-TIME-01 | Berlin wall time to instant, host-TZ independent | BR-04 | US-05 | `utils/time.ts` | unit: time; integration: TZ matrix | Implemented |
| FR-TIME-02 | Fall-back ambiguity resolved by `gw_seq` | BR-04 | US-05 | `utils/time.ts`, `telemetry/readings.ts` | unit: both 02:30s; acceptance: 300 intervals on 10-25 | Implemented |
| FR-TIME-03 | Nonexistent or non-increasing time gives `clock_anomaly` | BR-04 | US-05 | `telemetry/readings.ts` | unit | Implemented |
| FR-TIME-04 | ISO 8601 local + offset | BR-04 | US-05 | `utils/time.ts` | unit: formatting | Implemented |

## Functional: calculation

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-CALC-01 | Interval = consecutive reads per meter | BR-05 | US-01 | `report/build-report.ts` | unit: intervals | Implemented |
| FR-CALC-02 | Interval energy = scaled counter delta | BR-06 | US-01 | `telemetry/readings.ts`, `report/build-report.ts` | unit: decode, SF 0/1/−1; acceptance: billing, energy_kwh | Implemented |
| FR-CALC-03 | Attribute to start day; ignore out-of-window starts | BR-07 | US-01 | `report/build-report.ts` | unit: 23:55→00:00 | Implemented |
| FR-CALC-04 | Daily sum + interval count | BR-08 | US-01 | `report/build-report.ts` | unit; acceptance: interval counts | Implemented |
| FR-CALC-05 | Gap > 450 s gives a `gap` event | BR-09 | US-02 | `report/build-report.ts` | unit: 450/451 s; acceptance: 2 gaps | Implemented |
| FR-CALC-06 | Unknown energy gives 0 + event | BR-10 | US-03 | `report/build-report.ts` | unit: rollover, power_loss, counter_decrease, scale_factor_change; acceptance: M3 gap | Implemented |
| FR-CALC-07 | Peak valid power per day (raw register = three-phase total, C-02 a), earliest tie, `null` if none | BR-11 | US-04 | `report/build-report.ts` | unit: peak; acceptance: peak_at, raw-column peaks | Implemented |
| FR-CALC-08 | Count invalid power readings in window | BR-12 | US-04 | `telemetry/readings.ts`, `report/build-report.ts` | unit: 0x7FC00000, non-finite; acceptance: 3 | Implemented |

## Functional: output

| Req | Requirement | Rule | Story | Module | Tests | Status |
|---|---|---|---|---|---|---|
| FR-OUT-01 | Top-level keys and order | BR-15 | US-07 | `report/format.ts` | unit: formatting | Implemented |
| FR-OUT-02 | 9 daily rows, sorted, key order | BR-01 | US-01 | `report/format.ts` | unit; acceptance | Implemented |
| FR-OUT-03 | Round once: 2 dp / 1 dp | BR-14 | US-01, US-04 | `report/format.ts` | unit: rounding | Implemented |
| FR-OUT-04 | Deterministic event order | BR-15 | US-02 | `report/format.ts` | unit | Implemented |
| FR-OUT-05 | Single stdout write, JSON + `\n` | n/a | US-07 | `cli/index.ts` | integration: stdout parses | Implemented |

## Non-functional

| Req | Requirement | Source | Story | Where | Verification | Status |
|---|---|---|---|---|---|---|
| NFR-PLAT-01 | Node ≥ 20, TS strict, TASK commands work | TASK.md | US-07 | `package.json`, `.nvmrc`, `tsconfig.json` | integration via `npm start` | Implemented |
| NFR-PLAT-02 | No network or DB at runtime | TASK.md | n/a | all | security-reviewer grep | Implemented |
| NFR-DET-01 | Byte-identical output; host-TZ independent | architecture.md §1 | US-07 | `utils/time.ts`, `report/format.ts` | integration: TZ matrix | Implemented |
| NFR-PERF-01 | < 2 s on supplied file | srs.md | n/a | all | integration timing (log `durationMs`) | Implemented |
| NFR-PERF-02 | 50 MiB input cap | security-rules.md T-05 | n/a | `telemetry/read-input.ts` | unit | Implemented |
| NFR-SEC-01 | Only the named file is read, after the regular-file and size checks; path never echoed | CLAUDE.md Security Rules (user decision 2026-10-09) | US-08 | `cli/input-path.ts`, `telemetry/read-input.ts` | integration: directory, missing, stderr has no path | Implemented |
| NFR-SEC-02 | Untrusted input handling; `fw_msg` inert | CLAUDE.md, BR-13 | US-09, US-11 | `telemetry/` | unit: parsing, `fw_msg` | Implemented |
| NFR-SEC-03 | Config only via validated `env.ts` | CLAUDE.md | n/a | `config/env.ts` | `unit/infra.test.ts` (`parseEnv`) | Tested |
| NFR-SEC-04 | No PII or env in logs; no stack or paths on stdout | CLAUDE.md | US-08 | `errors/`, `logger/` | `unit/infra.test.ts` (no raw message leak) | Implemented |
| NFR-SEC-05 | Approved, pinned deps; no high/critical audit | CLAUDE.md | n/a | `package.json` | `npm audit` (2026-10-09: 0 prod, 20 moderate dev accepted) | Done |
| NFR-REL-01 | Fail closed | error-handling.md | US-08 | `errors/`, `cli/` | `unit/infra.test.ts`; integration failure paths | Implemented |
| NFR-REL-02 | Bad records never abort | BR-16 | US-09 | `telemetry/` | unit: parsing | Implemented |
| NFR-OBS-01 | JSON-lines app and error logs | architecture prompt §6 | n/a | `logger/` | `unit/infra.test.ts` (`createLogger`) | Tested |
| NFR-MAINT-01 | Type and lint rules pass | CLAUDE.md | n/a | `tsconfig.json`, `eslint.config.mjs` | `npm run typecheck`, `npm run lint` (rule probe verified) | Implemented |
| NFR-MAINT-02 | Unit + integration tests per standards | testing-standards.md | n/a | `tests/` | `npm test` | In Progress |
| NFR-MAINT-03 | Docs + RTM updated with code | CLAUDE.md | n/a | process | quality-checker / review | Implemented |
| NFR-PORT-01 | `node:path` only; LF/CRLF input | srs.md | n/a | `cli/`, `telemetry/` | unit: CRLF | Implemented |
