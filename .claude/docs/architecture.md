# Architecture: energy-report

> v0.1 · 2026-10-09 · **How** the tool is built. Requirements: `srs.md` · Rules: `business-rules.md`
> · Errors: `error-handling.md` · Security: `security-rules.md`.
> Status: infrastructure (config, errors, logger, run-command) and the feature modules (`cli/index`,
> `telemetry/`, `report/`, `utils/`) are built. Register decoding is in `register-map-analysis.md`.

## 1. Goals, in priority order

1. **Correct and honest numbers.** Follow the brief's rules exactly, never invent energy, and surface
   every anomaly.
2. **Deterministic.** Same input gives byte-identical output, on any machine and in any host time
   zone.
3. **Auditable.** Each rule has an id (BR-…), each requirement is traced (RTM), and logs are
   structured.
4. **Small.** One runtime dependency (`zod`), stdlib for everything else, and no speculative
   abstractions.

## 2. System context

```
              npm start -- telemetry.jsonl > output.json
 Operator ─────────────────────────────────────────────▶ energy-report (Node ≥ 20, one process)
                                                            │ read  : the one file named in argv (any path; regular file ≤ 50 MiB)
                                                            │ write : stdout  → report JSON (only on success)
                                                            │         stderr  → ✖ [CODE] message / warnings
                                                            │         logs/   → app.log, error.log (JSON lines)
                                                            ✗ network, database, other paths
```

## 3. Modules

| Module | Responsibility | May import | I/O |
|---|---|---|---|
| `src/cli/` | Entry point. Parses args, resolves the input path (cwd, then `input/`; no confinement), runs the pipeline inside `runCommand`, writes stdout once. | config, errors, logger, telemetry, report, types | stdout |
| `src/telemetry/` | Reads the file, parses and validates lines, de-duplicates, orders by `gw_seq`, resolves instants, decodes registers into `Reading`s. | config, errors, utils, types | reads the input file (`read-input.ts` only) |
| `src/report/` | **Pure.** Turns readings into intervals, daily rows, events and the formatted `Report`. | config, utils, types | none |
| `src/utils/` | **Pure** helpers, e.g. `time.ts` (zone conversion, ISO with offset, local date). | config (constants only), types | none |
| `src/config/` | `env.ts` (the only `process.env` reader, zod-validated, lazy) and `constants.ts` (no magic values elsewhere). | errors, types | none |
| `src/errors/` | `AppError`, `ErrorHandler`, dictionaries per module. | config, logger, types | stderr, exit |
| `src/logger/` | JSON-lines file logger: `appLogger` and `errorLogger` (the latter for ErrorHandler only). | config, types | `logs/` |
| `src/types/` | Shared interfaces and types only. | types | none |

Dependency rules:
- Nothing imports `cli/`.
- `report/` and `utils/` never do I/O and never log, so they can be unit-tested with plain values.
- Only `telemetry/read-input.ts` reads the input file. `cli/input-path.ts` only checks existence
  and resolves symlinks, using `read-input`'s fs-error translation (TEL-001/002).
- `types/` has no runtime code.

## 4. Processing pipeline

```
argv ─▶ [cli] parse args (node:util parseArgs, strict)          CLI-001/002
     ─▶ [cli] resolve (cwd, else input/) + realpath             TEL-001/002
     ─▶ [telemetry] stat: regular file, size cap; read UTF-8   TEL-001/002/003
     ─▶ [telemetry] split lines → JSON.parse (try/catch) → zod schema → cross-field checks
                      └─ failures → malformed_record events (line no. + reason)
     ─▶ [telemetry] de-duplicate by gw_seq → duplicates_dropped, duplicate_conflict
     ─▶ [telemetry] sort by gw_seq                              TEL-004 if nothing accepted
     ─▶ [telemetry] per meter: ts (Berlin wall) → instant, DST by gw_seq order → clock_anomaly
     ─▶ [telemetry] decode regs by ADDRESS → counter, SF, uptime, power (null = invalid)   ← register-map-analysis.md §1–2
     ─▶ [report] consecutive reads per meter → intervals (energy, gap, unknown)
     ─▶ [report] attribute to start day; daily sums, counts, peaks; invalid_power_readings
     ─▶ [report] format: round once, ISO local+offset, fixed key and event order
     ─▶ [cli] process.stdout.write(JSON.stringify(report, null, 2) + "\n")
```

Everything before the final write is side-effect free apart from logging. Any fatal `AppError`
therefore leaves stdout empty (NFR-REL-01).

### Proposed files

These are a starting point; the developer may merge files and should not add more.
- `cli/index.ts`, `cli/input-path.ts`
- `telemetry/read-input.ts`, `telemetry/parse.ts` (schema, dedupe, sort), `telemetry/readings.ts`
  (time and decode)
- `report/build-report.ts` (intervals, aggregation), `report/format.ts`
- `utils/time.ts`

## 5. Key types (sketch, final shapes in `src/types/`)

```ts
type MeterId = 'M1' | 'M2' | 'M3';

/** Validated record. `fw_msg` is deliberately NOT carried past validation (BR-13). */
interface TelemetryRecord {
  readonly line: number; readonly gwSeq: number; readonly ts: string; readonly meter: MeterId;
  readonly unitId: number; readonly fc: number; readonly startAddr: number; readonly qty: number;
  readonly regs: readonly number[];
}

interface Reading {
  readonly gwSeq: number; readonly meter: MeterId;
  readonly at: number;            // instant, epoch ms
  readonly offsetMinutes: number; // +120 / +60, for output formatting
  readonly localDate: string;     // YYYY-MM-DD in Europe/Berlin
  readonly counter: number;        // uint32 raw counts (PDU 102–103); energy Wh = counter × 10^sf
  readonly sf: number;             // int16 (PDU 104)
  readonly uptimeS: number;        // uint32 seconds since power-up (PDU 105–106)
  readonly powerW: number | null;  // float32 (PDU 100–101), raw register = three-phase total (C-02 a); null = not available / non-finite
}

interface Interval {
  readonly meter: MeterId; readonly start: Reading; readonly end: Reading;
  readonly seconds: number; readonly isGap: boolean;
  readonly energyKwh: number;     // 0 when unknown
  readonly unknownReason: string | null;
}

type ReportEvent = GapEvent | EnergyUnknownEvent | ClockAnomalyEvent | DuplicateConflictEvent | MalformedRecordEvent;
interface DailyRow { date: string; meter: MeterId; energy_kwh: number; intervals: number; peak_power_w: number | null; peak_at: string | null }
interface Report { site_timezone: 'Europe/Berlin'; daily: DailyRow[]; events: ReportEvent[]; duplicates_dropped: number; invalid_power_readings: number }
```

Output field names keep the brief's snake_case. Internal names are camelCase.

## 6. Time handling (`utils/time.ts`)

There is no time-zone library. `Intl.DateTimeFormat` with `timeZone: 'Europe/Berlin'` and
`timeZoneName: 'longOffset'` gives the offset at any instant. Node ships full ICU.

To convert a wall time `W` to an instant:
1. Take `W` as if it were UTC: `Wz = Date.UTC(y, m-1, d, h, mi, s)`. Validate the components by
   round-tripping them.
2. Candidate offsets are the zone's offsets at `Wz − 24h` and `Wz + 24h`. Any transition within a
   day yields both offsets.
3. For each candidate `o`, the instant is `Wz − o`. Keep it if `offsetAt(instant) === o`.
4. **0 candidates** means the time doesn't exist (`clock_anomaly`). **1** is unique. **2** is
   ambiguous, so pick the earliest instant later than the meter's previous read (BR-04).

Formatting: compute `instant + offset`, format the components with UTC getters, and append
`±HH:MM`.

Every `time.ts` function takes the IANA zone as a parameter, because `utils/` imports only `types/`.
Callers in `telemetry/` and `report/` pass `SITE_TIMEZONE`. One `Intl.DateTimeFormat` per zone is
cached. Never use `new Date('YYYY-MM-DD HH:mm:ss')` (implementation-defined) or local getters
(`getHours`, which depend on the host time zone).

## 7. Errors and logging

```
throw new AppError({...dictionary entry})  ──▶ runCommand catch ──▶ errorHandler.handle(e)
   (anywhere in the pipeline)                    (non-Error → SYS-001)     ├─ errorLogger → logs/error.log
                                                                           ├─ stderr: ✖ [CODE] message
                                                                           └─ process.exit(1)
```

- **Fatal problems** (bad args or path, unreadable file, invalid env, bugs) are `AppError`s. Details
  are in `error-handling.md`.
- **Data problems** (malformed lines, gaps, unknown energy, …) are **not errors**. They become
  report `events` and the run continues (NFR-REL-02).
- `appLogger` records command start and finish, `durationMs`, and counts such as records read,
  accepted and duplicates. Never record contents.

## 8. Build and runtime

- `tsc -p tsconfig.build.json` compiles `src/` to CommonJS in `dist/`. `npm start` runs
  `node dist/cli/index.js`.
- `prestart` builds with its output redirected to stderr, and `.npmrc` sets `loglevel=silent` to
  suppress npm's stdout banner. Together they keep stdout pure JSON (US-07).
- `constants.ts` resolves the project root as `__dirname/../..`. That works from both `src/`
  (ts-jest) and `dist/`, so `input/` and `logs/` are found regardless of cwd.

## 9. Decisions

| # | Decision | Why | Alternatives rejected |
|---|---|---|---|
| D-01 | CommonJS output + Jest/ts-jest | User chose Jest. Jest's ESM mode is still experimental. | ESM + Vitest |
| D-02 | `zod` is the only runtime dependency | Typed boundary parsing without writing `unknown` | Hand-written guards (more code, `unknown` everywhere) |
| D-03 | `node:util` `parseArgs` | One positional arg; stdlib covers it | commander |
| D-04 | Own ~50-line JSON-lines logger with a synchronous `appendFileSync` per line | Two sinks, a one-shot CLI, few lines per run. Limit: one sync write per line; switch to a write stream if log volume grows. | pino (dependency + async flush on exit) |
| D-05 | `Intl` for time zones | Covers the conversion, no dependency, Node ships ICU | luxon, date-fns-tz |
| D-06 | Sync whole-file read with a 50 MiB cap | Input is 420 KB; simplest correct option | Streaming readline (add if inputs grow) |
| D-07 | Pure `report/` core | Every business rule unit-testable without I/O | Logic mixed with I/O |
| D-08 | Data anomalies become events, not errors | The brief wants them reported, and the run must still produce a report | Failing the run |
| D-09 | `gw_seq` is the ordering truth | File order is shuffled and `ts` repeats in the DST hour | Sorting by `ts` |
| D-10 | Map registers by address | M3's window starts at 99, not 100 | Array index |
| D-11 | TypeScript 5.9.3 | `ts-jest` and `typescript-eslint` don't support TS 7 | TS 7.0 |
| D-12 | `.npmrc` `loglevel=silent` | npm prints its run banner to stdout and would corrupt `output.json` | `json=true` (only newer npm 10) |
| D-13 | `logs/` as the one extra write path | Explicitly requested by the architecture prompt | stdout/stderr only |
| D-14 | Input path can be any file (cwd first, then `input/`), with no base-directory confinement | User decision 2026-10-09. Guarded by realpath, a regular-file check, the size cap, and never echoing the path. | Confinement to `input/` (former CLI-003, removed) |
| D-15 | Peak power uses the raw register as the three-phase total, no ×3 | User decision 2026-10-09 (C-02 a). The data shows the raw value matches the counter-implied total. | ×3 per map note 5 |

## 10. Open items

- Once the feature lands: enable a Jest `coverageThreshold` (`testing-standards.md` §7).
