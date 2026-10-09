# Plan: energy-report feature (step D of initial-architecture-plan)

## Context

`/build` was invoked with no argument. The only outstanding work in the repo is **step D** of
`.claude/plans/initial-architecture-plan.md`: the feature modules (`cli/index`, `telemetry/`,
`report/`, `utils/`). Infra is done (config, errors, logger, `runCommand`, `tests/unit/infra.test.ts`).

**Decode source:** `.claude/docs/register-map.md` (vendor map, restored verbatim) and
`.claude/docs/register-map-analysis.md` (interpretation with evidence). Checked: the analysis matches
the map (low word first, 0x7FC00000 N/A, 2^32 rollover, hourly save, note 5 ×3).

### Doc gaps found by the developer (none occur in the supplied data; defaults go into the docs)

1. **Event order (FR-OUT-04):** `malformed_record` by line → `duplicate_conflict` / `clock_anomaly`
   by `gw_seq`, then type → interval events (`gap`, `energy_unknown`, `counter_rollover`) by start
   instant, meter, type.
2. **Reasons:** `clock_anomaly`: `nonexistent_time`, `non_increasing_time`. Malformed adds
   `unit_id_mismatch`, `function_code`, `invalid_ts` (srs §6, BR-15, error-handling §5).
3. **Identical duplicate (FR-SEQ-01):** every validated field except `fw_msg`, which is never read
   after validation.
4. **Out-of-window intervals:** ignored entirely, including events. Malformed, duplicate and clock
   findings are reported regardless of date.
5. **Input path is dynamic (user decision, replaces `input/` confinement):** the CLI argument is
   any file path the user gives. `path.resolve(cwd, arg)`; if that doesn't exist, fall back to
   `path.resolve(input/, arg)` so the TASK's literal `npm start -- telemetry.jsonl` still finds
   `input/telemetry.jsonl`. No base-directory check, so **CLI-003 is removed**. Kept: exactly one
   positional (CLI-001/002), regular-file check (TEL-002), size cap (TEL-003), ENOENT → TEL-001,
   symlinks followed via `realpathSync`.
   - Docs to change with it: CLAUDE.md (Commands "must resolve inside input/", Security & commit
     policy "paths that can escape input/", Security Rules → "Path traversal & file system" and
     "Principle of least privilege": reads are the one file named on the command line);
     `security-rules.md` (threat model/controls/checklist), `srs.md` FR-CLI-02 + NFR-SEC-01,
     `architecture.md` (§2 context, §3 cli row, §4 pipeline), `error-handling.md` (drop CLI-003),
     `testing-standards.md` §4 (replace traversal cases with: absolute path outside the repo to a
     temp `.jsonl` → exit 0; directory → TEL-002; missing → TEL-001), RTM.
   - security-reviewer is told this is a user-approved change, so it isn't flagged as a regression.
   - Files: `src/cli/input-path.ts` stays, but only resolves (no confinement). `cli.errors.ts`
     has CLI-001/002 only.

Developer's detailed file/type breakdown: `rustling-exploring-snail-agent-abe33b8fcb1a70241.md`.
Skips `POWER_SCALE` (decided) and `REQUIRED_ADDR_FIRST/LAST` (per-register lookup is the check).

### Decode (register-map-analysis.md §1–2, §4–5)

- Look up by PDU address: `regs[addr − start_addr]`. Every record must cover PDU 100–106, else
  `malformed_record`. If PDU 99 is covered it must equal `PM3_MODEL_ID` 0x1F4A, else malformed.
- uint32 = `high × 65536 + low`, low word at the lower address.
- Power (100 low / 101 high) float32 from `bits = high << 16 | low` (DataView, big-endian per
  register). Invalid = `bits === 0x7FC00000` or non-finite → `null`, counted in
  `invalid_power_readings` (expect 3, all M1).
- **C-02 decided by user: raw register is the three-phase total, no ×3.** Note-5 conflict goes to
  NOTES.md.
- Energy counter 102/103 uint32, SF at 104 int16, Wh = counter × 10^SF; interval energy uses the raw
  integer Δ then scales, kWh at the end.
- Uptime 105/106 uint32 seconds.
- Interval energy rules, in order:
  1. Restart (`uptime_end < interval seconds`) → 0, reason `power_loss` (C-05).
  2. SF differs between the two reads → 0, reason `scale_factor_change` (map note 3 says it can't;
     guard only).
  3. `counter_end ≥ counter_start` → normal Δ.
  4. Else modular Δ = `(end − start + 2^32) mod 2^32`; if Δ < 2^31 → counted, event
     `counter_rollover` (C-04). Otherwise → 0, reason `counter_decrease`.
- Zeroed non-gap intervals → `energy_unknown` event; zeroed gaps → `gap` with
  `energy_counted: false, reason`.
- `fw_msg` SF=2 claim ignored (C-01, BR-13).

## Approach

On execution, first copy this plan to `.claude/plans/feature-energy-report.md` (CLAUDE.md requires
the plan in-repo before code), then run the pipeline with the project agents:
**developer → quality-checker → tester → security-reviewer**, stopping at the first failure.

### Files (as proposed in `architecture.md` §4, no extras)

- `src/types/telemetry.ts`, `src/types/report.ts`, `src/types/cli.ts`: `MeterId`, `TelemetryRecord`,
  `Reading`, `Interval`, `ReportEvent` union, `DailyRow`, `Report`, CLI args.
- `src/types/errors.ts`: add `'CLI' | 'TELEMETRY'` to `ErrorModule`.
- `src/errors/modules/cli.errors.ts` (CLI-001 missing arg, CLI-002 extra arg/option; no CLI-003,
  see decision 5), `telemetry.errors.ts` (TEL-001 not found, TEL-002 not a readable file, TEL-003
  over `MAX_INPUT_BYTES`, TEL-004 no accepted records). No `RPT-` codes: `report/` is pure and
  never throws.
- `src/config/constants.ts`: `SITE_TIMEZONE`, `REPORT_DAYS`, `METERS`, `METER_UNIT_IDS`,
  `GAP_THRESHOLD_SECONDS` (450), `MAX_INPUT_BYTES` (50 MiB), `ENERGY_DECIMALS`, `POWER_DECIMALS`,
  `MODBUS_FC_READ_HOLDING`, register addresses + sentinels **from register-map.md**.
- `src/cli/index.ts` (parseArgs strict, one positional, `runCommand`, single stdout write),
  `src/cli/input-path.ts` (resolve against cwd, fall back to `input/`, `realpathSync`; no
  confinement, see decision 5).
- `src/telemetry/read-input.ts` (stat + size cap + UTF-8 read, the only fs input),
  `parse.ts` (split lines, `JSON.parse` in try → zod `.safeParse`, cross-field checks, dedupe by
  `gw_seq`, sort), `readings.ts` (instant resolution via `utils/time`, decode regs **by address**).
- `src/utils/time.ts`: Intl-based wall→instant with DST candidates (architecture.md §6), ISO with
  offset, local date.
- `src/report/build-report.ts` (intervals, gap > 450 s, day attribution by start, never-invent → 0 +
  event, peak with earliest tie, invalid power count), `src/report/format.ts` (round once, key order,
  9 rows, deterministic event order).
- Tests: `tests/unit/{time,parse,readings,build-report,format}.test.ts`,
  `tests/integration/cli.test.ts` per `testing-standards.md` §3–5; enable `coverageThreshold` (90 %
  lines/branches for telemetry, report, utils) in `jest.config.mjs`.
- Docs in the same change: fill the TBDs in `srs.md`, `business-rules.md`, `architecture.md`
  (status + open items), `error-handling.md` code registry, `testing-standards.md` §5 exact values,
  RTM status.

### Rules that stay fixed regardless of the map

- `gw_seq` is the only ordering truth; identical duplicates counted (expect 37).
- DST fall-back hour resolved per meter by `gw_seq` order.
- `fw_msg` is never interpreted, including the M2 scale-factor "instruction" (BR-13).
- Customer's "last − first" method rejected (BR-17).

## Verification

- `npm run typecheck && npm run lint && npm test` green.
- `npm start -- telemetry.jsonl > output.json` produces pure JSON.
- Acceptance (`testing-standards.md` §5): 9 rows; intervals 10-24 M1 283 / M2 288 / M3 288,
  10-25 300 each, 10-26 M1 288 / M2 288 / M3 280; exactly 2 gaps; `duplicates_dropped` 37; 0
  malformed / clock_anomaly / duplicate_conflict.
- Exact values from register-map-analysis.md §6 (raw-register peaks): e.g. 10-24 M1 913.45 kWh,
  peak 48,085.5 W at 14:25:00+02:00; 10-25 M1 peak 71,250.5 W at 02:35:00+01:00 (second DST pass);
  events = M1 gap (counted), M2 `counter_rollover` 04:40:01→04:45:01+01:00, M3 gap
  (`power_loss`, not counted); `invalid_power_readings` 3.
- Billing: Σ 10-24 energy = 1,705.566 ∈ [1703.89, 1707.31] kWh. A miss means investigate the
  decode, never tune.
- `register-map-analysis.md` is already in the CLAUDE.md docs table. Write `output.json` at the end.
- `NOTES.md` (empty) is the user's: C-02 note-5 conflict and the `fw_msg` SF=2 message still need
  writing up there. Not part of this change.
- Byte-identical output under `TZ=UTC`, `Asia/Kolkata`, `America/New_York`.
- security-reviewer: `npm audit`, no commit made. Path checks: no shell, the argument goes only to
  `path.resolve` and fs, and the error message never echoes the path (no system paths on stderr).
- Integration: `npm start -- telemetry.jsonl`, `input/telemetry.jsonl`, and an absolute path to a
  temp copy outside the repo all give byte-identical stdout.

## Implementation notes (developer, 2026-10-09)

- Decision 5 was applied after the user confirmed it directly ("the input file can be anywhere in
  the file system"). CLI-003 is retired, not reused.
- `utils/time.ts` takes the zone as a parameter (`utils/` imports only `types/`); callers pass
  `SITE_TIMEZONE`.
- Unit-test entry points: `utils/time` (`parseWallTime`, `instantCandidates`, `offsetMinutesAt`,
  `toLocalIso`, `localDateOf`), `telemetry/readings` (`decodeRegisters`, `resolveReadings`),
  `telemetry/parse` (`parseTelemetry`), `telemetry/read-input` (`readInput`, `withInputFsErrors`),
  `cli/input-path` (`resolveInputPath`), `report/build-report` (`buildReport`; the interval energy
  rules are tested through it), `report/format` (`formatReport`).
- Sanity run matched every value in `register-map-analysis.md` §6 (raw column). Unrounded
  2026-10-24 total = 1,705.5662 kWh.
