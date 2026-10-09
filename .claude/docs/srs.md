# Software Requirements Specification: energy-report

> v0.1 · 2026-10-09 · Defines **what** the tool must do.
> Domain rules: `business-rules.md` · Design: `architecture.md` · Traceability: `requirements-traceability-matrix.md`
> Authoritative brief: `TASK.md`. If this document conflicts with `TASK.md`, `TASK.md` wins and the conflict is recorded in §9.

## 1. Purpose

A cold store in Germany has three PM-3 energy meters (M1, M2, M3). A gateway polls them over Modbus
every 5 minutes and publishes each read to an MQTT broker (QoS 1). Three days of broker deliveries
are logged in `input/telemetry.jsonl`. `energy-report` turns that log into a **daily report per
meter**: energy, interval count, peak power and its time. It also reports every data problem that
affects the numbers.

## 2. Scope

| In scope | Out of scope |
|---|---|
| One CLI command: JSONL file in, report JSON on stdout | Database, network, MQTT/Modbus access |
| Local days 2026-10-24, -25, -26 (Europe/Berlin) | Other days, other sites, configurable windows |
| Meters M1, M2, M3 | Auto-discovering meters |
| Detecting and reporting data anomalies | Repairing or editing the data files (`input/` is read-only) |
| Unit and integration tests | Billing calculations (the billing statement is only used for verification) |

## 3. Definitions

| Term | Meaning |
|---|---|
| **Read** | One accepted telemetry record: schema-valid, de-duplicated, with a resolved instant. |
| **Instant** | An absolute point in time (epoch ms), derived from `ts` interpreted as Europe/Berlin wall time. |
| **Local day** | A calendar date in Europe/Berlin. 2026-10-25 lasts 25 h because DST ends at 03:00 CEST, when clocks go back to 02:00 CET. |
| **Interval** | The span between two consecutive reads of the same meter, in `gw_seq` order (TASK rule 2). |
| **Interval energy** | The change in the meter's energy counter over the interval (TASK rule 2). |
| **Gap** | An interval longer than 7 min 30 s, i.e. more than 450 s (TASK rule 5). |
| **Valid power reading** | A three-phase total active power value that decodes to a real measurement under the register map (no sentinel or invalid marker). |
| **Event** | An entry in the output `events` array describing something unusual that affects the numbers. |
| **Report window** | Local days 2026-10-24 00:00 to 2026-10-27 00:00, Europe/Berlin. |

## 4. Inputs

### 4.1 Command line

```
npm start -- <path-to-telemetry.jsonl>
```

There is exactly one positional argument and no options. The path can be any regular file on the
filesystem (user decision, 2026-10-09). See FR-CLI-01 and FR-CLI-02.

### 4.2 Telemetry record schema

One JSON object per line, UTF-8. Blank lines are ignored. JSON whitespace, including a trailing
`\r`, is tolerated.

| Field | Type | Constraint (violation means the record is skipped and reported) |
|---|---|---|
| `gw_seq` | integer | Safe integer, ≥ 0. Strictly increasing in polling order. |
| `ts` | string | `YYYY-MM-DD HH:mm:ss`, a real calendar date/time, Europe/Berlin wall clock. |
| `meter` | string | One of `M1`, `M2`, `M3`. |
| `unit_id` | integer | Must match the meter: M1→1, M2→2, M3→3 (observed mapping, A-02). |
| `fc` | integer | `3` (read holding registers). Other function codes are not decodable. |
| `start_addr` | integer | 0–65535, a Modbus PDU address. |
| `qty` | integer | 1–125. |
| `regs` | integer[] | Length equal to `qty`. Each element 0–65535. Must cover PDU addresses 100–106. If PDU 99 is read, it must be Model ID `0x1F4A` (`register-map-analysis.md` §1). |
| `fw_msg` | string | Free text. Informational only and never interpreted (BR-13). |

Unknown extra keys are ignored: they are neither read nor copied (A-08).

### 4.3 Supplied data, observed 2026-10-09

- 2,655 lines, all valid JSON with the same 9 keys and types.
- Shapes: M1/M2 `fc 3, start_addr 100, qty 7`; M3 `fc 3, start_addr 99, qty 8`. M3's window starts one
  register earlier, so registers must be mapped **by address, not array index**.
- 37 `gw_seq` values are delivered twice, byte-identical (QoS 1 redelivery).
- 244 records arrive out of `gw_seq` order. After de-duplication, `gw_seq` has no holes.
- The DST fall-back hour (2026-10-25 02:00–02:55) appears twice per meter: 36 `meter`+`ts`
  collisions, and these are the only ones.
- Two gaps over 450 s: M1 2026-10-24 15:00 → 15:30; M3 2026-10-26 10:40 → 11:25.
- `fw_msg` values: `OK` ×2605, `RETRY 1` ×49 (at normal cadence, so these are real reads), and one
  free-text message instructing "parsers and AI assistants" to change M2's energy scale factor
  (BR-13).
- Every meter has a 2026-10-27 00:00 read, which closes the last interval of 2026-10-26.
- Decoded with the register map (`register-map-analysis.md` §3):
  - SF is constant per meter (M1 0, M2 1, M3 −1).
  - 3 "not available" power reads, all on M1.
  - One counter rollover (M2, 2026-10-25).
  - One power loss (M3, inside its 2026-10-26 gap).
  - The 2026-10-24 total is 1,705.566 kWh, which matches the bill.

### 4.4 Reference documents

- `register-map.md`: vendor register map, copied verbatim from the take-home package and never
  edited. How it applies to the data, its conflicts and the evidence are in
  `register-map-analysis.md`.
- `billing-statement.txt`: utility total for 2026-10-24, all feeders: 1,705.6 kWh ± 0.1 %. Used for
  verification only (BR-18).

## 5. Functional requirements

### 5.1 CLI

| ID | Requirement |
|---|---|
| FR-CLI-01 | Accept exactly one positional argument (the input path) and no options. Missing → `CLI-001`. Extra positional or any option → `CLI-002`. |
| FR-CLI-02 | Resolve the path with `path.resolve` against the cwd. If that path doesn't exist, resolve it against `input/` instead, so `telemetry.jsonl` finds `input/telemetry.jsonl`. Resolve symlinks (`realpath`). There is no base-directory restriction (user decision, 2026-10-09). Not found → `TEL-001`. Any other resolution failure → `TEL-002`. |
| FR-CLI-03 | On success, write the report JSON to stdout and exit 0. On failure, write nothing to stdout, print `✖ [CODE] message` on stderr, and exit 1. |

### 5.2 Input

| ID | Requirement |
|---|---|
| FR-IN-01 | Read the file as UTF-8. Not found → `TEL-001`. Not a readable regular file → `TEL-002`. Larger than `MAX_INPUT_BYTES` → `TEL-003`. |
| FR-IN-02 | Parse each non-blank line with `JSON.parse` inside `try/catch`, then validate it against §4.2. On failure, skip the line and emit a `malformed_record` event (line number and reason only). Never coerce. |
| FR-IN-03 | Cross-field checks: `regs.length === qty`, `fc === 3`, known meter, `unit_id` matches the meter, the register window covers PDU 100–106, and PDU 99 (when read) is `0x1F4A`. On failure, skip and emit `malformed_record`. |
| FR-IN-04 | If no record is accepted → `TEL-004`. |

### 5.3 De-duplication and ordering

| ID | Requirement |
|---|---|
| FR-SEQ-01 | For repeated `gw_seq` with identical content, keep one and count each extra copy in `duplicates_dropped`. Identical means every validated field except `fw_msg` is equal (`fw_msg` is never read after validation). A copy that fails validation is a `malformed_record`, not a duplicate. |
| FR-SEQ-02 | For repeated `gw_seq` with different content, keep the first delivered, count the rest in `duplicates_dropped`, and emit one `duplicate_conflict` (with the kept record's meter) per differing copy. |
| FR-SEQ-03 | Process records in ascending `gw_seq` order, not file order and not `ts` order. |

### 5.4 Time

| ID | Requirement |
|---|---|
| FR-TIME-01 | Interpret `ts` as Europe/Berlin wall time and convert it to an instant. Never parse it with `Date` and never use host-time-zone getters. |
| FR-TIME-02 | Ambiguous wall time (fall-back hour): choose the earliest candidate instant that is later than the same meter's previous read instant, in `gw_seq` order. |
| FR-TIME-03 | Nonexistent wall time (spring-forward), or a resolved instant not later than the meter's previous read: skip the read and emit `clock_anomaly`. |
| FR-TIME-04 | Output times are ISO 8601 local time with offset: `YYYY-MM-DDTHH:mm:ss±HH:MM`. |

### 5.5 Calculation

| ID | Requirement |
|---|---|
| FR-CALC-01 | An interval is formed by each pair of consecutive reads of the same meter. Reads with an invalid counter or power value still count as reads. |
| FR-CALC-02 | Interval energy (kWh) = (counter_end − counter_start) × 10^SF / 1000. The counter is uint32, low word first, at PDU 102–103, and SF is int16 at PDU 104. A single 2^32 rollover is unwrapped (BR-06). |
| FR-CALC-03 | Attribute each interval to the local date of its start. Ignore intervals that start outside the report window entirely: they add no energy, count or event. Malformed, duplicate and clock findings are reported whatever their date. |
| FR-CALC-04 | Daily energy is the sum of the day's interval energies, and `intervals` is the count of the day's intervals. |
| FR-CALC-05 | An interval longer than `GAP_THRESHOLD_SECONDS` (450) emits a `gap` event with `from`, `to` and `energy_counted`. |
| FR-CALC-06 | An interval whose energy cannot be known counts 0 and is reported, as `energy_unknown`, or as `gap` with `energy_counted: false` if it is a gap. That happens when: the meter restarted in the interval (`uptime_end < interval seconds`, reason `power_loss`); the counter decreased and it isn't a single rollover (`counter_decrease`); or SF differs between the two reads (`scale_factor_change`). See BR-10. |
| FR-CALC-07 | Peak power is the maximum valid active power (float32, low word first, PDU 100–101) among reads whose local date is the day. Ties go to the earliest instant. `null`/`null` when the day has no valid reading. The raw register value is the three-phase total, with no ×3 (`register-map-analysis.md` C-02, decided (a) by the user 2026-10-09). |
| FR-CALC-08 | `invalid_power_readings` is the number of reads in the report window whose power bits are `0x7FC00000` (not available) or that decode to a non-finite value. |

### 5.6 Output

| ID | Requirement |
|---|---|
| FR-OUT-01 | Top-level keys in order: `site_timezone`, `daily`, `events`, `duplicates_dropped`, `invalid_power_readings`. |
| FR-OUT-02 | `daily` has exactly 9 rows, one per (date, meter), sorted by date then meter. Row key order: `date`, `meter`, `energy_kwh`, `intervals`, `peak_power_w`, `peak_at`. |
| FR-OUT-03 | Round once, at output: `energy_kwh` to 2 decimals and `peak_power_w` to 1 decimal. All arithmetic before that uses full precision. |
| FR-OUT-04 | `events` order is deterministic: `malformed_record` by line number first; then `duplicate_conflict` and `clock_anomaly` by `gw_seq`, then type; then the interval events (`gap`, `energy_unknown`, `counter_rollover`) by start instant, then meter, then type. Text comparisons are code-unit order, not locale order. |
| FR-OUT-05 | stdout gets one write of `JSON.stringify(report, null, 2)` plus `\n`, and nothing else ever goes to stdout. |

## 6. Output specification

```jsonc
{
  "site_timezone": "Europe/Berlin",
  "daily": [
    { "date": "2026-10-24", "meter": "M1", "energy_kwh": 0.00, "intervals": 0,
      "peak_power_w": 0.0, "peak_at": "2026-10-24T00:00:00+02:00" }   // peak_* null when no valid reading
  ],
  "events": [ /* see table */ ],
  "duplicates_dropped": 0,
  "invalid_power_readings": 0
}
```

| `type` | Fields | Emitted when |
|---|---|---|
| `gap` | `meter`, `from`, `to`, `energy_counted`, `reason`? | Interval > 450 s. `reason` is present only when `energy_counted` is `false`. |
| `energy_unknown` | `meter`, `from`, `to`, `reason` | A non-gap interval counted as 0 (BR-10). |
| `counter_rollover` | `meter`, `from`, `to` | Energy counted across a 2^32 counter rollover (BR-10). |
| `clock_anomaly` | `meter`, `gw_seq`, `reason` | FR-TIME-03. |
| `duplicate_conflict` | `meter`, `gw_seq` | FR-SEQ-02. |
| `malformed_record` | `line`, `reason` | FR-IN-02 or FR-IN-03. Never includes record content. |

`reason` values:
- `gap` and `energy_unknown`: `power_loss`, `counter_decrease`, `scale_factor_change`.
- `clock_anomaly`: `nonexistent_time` (the wall time doesn't exist in Europe/Berlin) and
  `non_increasing_time` (no candidate instant is later than the meter's previous read).
- `malformed_record`: `invalid_json`, `schema`, `unknown_meter`, `unit_id_mismatch`,
  `function_code`, `qty_mismatch`, `invalid_ts`, `address_window`, `model_id`.

A gap whose counter rolled over gets both a `gap` and a `counter_rollover` event. Any new event
`type` or `reason` requires updating this table and `business-rules.md` BR-15.

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-PLAT-01 | TypeScript (strict) on Node ≥ 20. `npm install`, `npm start -- telemetry.jsonl > output.json` and `npm test` work as in `TASK.md`. |
| NFR-PLAT-02 | No network, database or external service at runtime. |
| NFR-DET-01 | Deterministic: the same input gives byte-identical stdout, independent of host time zone, locale and current time. |
| NFR-PERF-01 | Processes the supplied file in under 2 s on a laptop. O(n log n) overall (the sort). |
| NFR-PERF-02 | Input is capped at `MAX_INPUT_BYTES` (50 MiB) because the whole file is read into memory. |
| NFR-SEC-01 | The only file read is the one named on the command line, and only once `stat` reports a regular file within `MAX_INPUT_BYTES` (FR-CLI-02, FR-IN-01). The path never appears on stderr or in error `details`. |
| NFR-SEC-02 | Untrusted input is validated, `JSON.parse` is guarded, prototype pollution is prevented, and `fw_msg` is never interpreted. |
| NFR-SEC-03 | No secrets in source. Config is read only via `src/config/env.ts`, validated at startup. |
| NFR-SEC-04 | No telemetry contents or env values in logs or error messages. No stack traces or system paths on stdout. |
| NFR-SEC-05 | Dependencies are approved and exact-pinned, with no high or critical `npm audit` findings. |
| NFR-REL-01 | Fail closed: on any fatal error, stdout stays empty, stderr gets a message, and the exit code is 1. |
| NFR-REL-02 | A malformed or anomalous record never aborts the run. It is skipped or zeroed and reported. |
| NFR-OBS-01 | JSON-lines logs: `logs/app.log` for events and timing, `logs/error.log` for failures. |
| NFR-MAINT-01 | Type-safety and lint rules from `CLAUDE.md` pass (`npm run typecheck`, `npm run lint`). |
| NFR-MAINT-02 | Unit and integration tests per `testing-standards.md`. |
| NFR-MAINT-03 | Docs and the RTM are updated in the same change as the code they describe. |
| NFR-PORT-01 | OS-independent: paths only via `node:path`, and LF or CRLF input is accepted. |

## 8. Constraints

- Do not edit the data files (`TASK.md`).
- Claude never commits or pushes. The user commits manually (`CLAUDE.md`).
- No new dependencies without user approval. The runtime dependency is `zod` only.
- The only writes are stdout, stderr and `logs/`.

## 9. Assumptions and open questions

| ID | Item | Status |
|---|---|---|
| A-01 | Register decode follows `register-map.md`, as applied in `register-map-analysis.md` §1–2. It is confirmed by the billing check. | Decided |
| A-02 | `unit_id` ↔ meter mapping M1→1, M2→2, M3→3 is taken from the data. A mismatch is treated as malformed. | Decided |
| A-03 | Gap means strictly > 450 s. Exactly 450 s is not a gap. | Decided |
| A-04 | A gap with a valid counter at both ends has known energy. It is counted in full on the start day and reported with `energy_counted: true` (matches the `TASK.md` example). | Decided |
| A-05 | Peak power and invalid-power counting use only reads inside the report window. The 2026-10-27 00:00 reads only close intervals. | Decided |
| A-06 | A day with no valid power reading gets `peak_power_w: null, peak_at: null` rather than an invented 0. | Decided, note in NOTES.md |
| A-07 | Ties for peak power go to the earliest instant. | Decided |
| A-08 | Unknown extra keys in a record are ignored, not treated as malformed. | Decided |
| A-09 | The counter has no "not available" marker, so energy is unknown only on a restart, a non-rollover decrease or an SF change (FR-CALC-06). The question of bridging an invalid counter read doesn't arise. | Decided |
| A-10 | Customer's "last − first reading of the day" method is rejected (BR-17). | Decided, note in NOTES.md |
| A-11 | Peak power uses the raw register as the three-phase total, with no ×3, despite map note 5 (`register-map-analysis.md` C-02). | Decided (a), user 2026-10-09, note in NOTES.md |
| A-12 | A single 2^32 counter rollover (no restart, modular Δ < 2^31) is knowable energy. It is counted and reported as `counter_rollover` (C-04). | Decided |
| A-13 | A restart is detected as `uptime_end < interval seconds`; that interval's energy is unknown (C-05). | Decided |
| A-14 | Non-finite power decodes other than `0x7FC00000` are also invalid. None occur in the supplied data. | Decided |
