# Business Rules: energy-report

> v0.1 · 2026-10-09 · Domain rules the code must implement exactly. Each rule cites its source.
> "TASK n" refers to rule n in `TASK.md`. Requirement ids (FR-…) are in `srs.md`.
> Register decoding: `register-map.md` (vendor, verbatim) as applied in `register-map-analysis.md`.

## BR-01 Report window
Report the local days **2026-10-24, 2026-10-25 and 2026-10-26** in **Europe/Berlin**, for meters
M1, M2 and M3. That is always 9 daily rows, even when a meter has no data on a day. *(TASK 1, Output)*
- 2026-10-25 lasts **25 hours**: CEST (+02:00) ends at 03:00 and clocks go back to 02:00 CET (+01:00).
- The window runs from 2026-10-24T00:00:00+02:00 to 2026-10-27T00:00:00+01:00.

## BR-02 Ordering
`gw_seq` is assigned in polling order and is strictly increasing. It is the **only** ordering truth.
File order is broker delivery order: 244 records arrive out of order. `ts` repeats in the DST hour.
*(TASK: Telemetry format)*

## BR-03 Duplicates (QoS 1)
The broker uses QoS 1, which means at-least-once delivery, so the same read can arrive more than once.
- Records with the same `gw_seq` and identical content are one read. Keep one and count each extra
  copy in `duplicates_dropped` (37 in the supplied data). Identical means every validated field
  except `fw_msg` matches (BR-13: `fw_msg` is never read after validation).
- Same `gw_seq` with different content cannot be resolved from the data. Keep the first delivered,
  count the rest as dropped, and emit `duplicate_conflict` (none in the supplied data).

## BR-04 Local time and DST
`ts` is gateway wall-clock time in Europe/Berlin. *(TASK: Telemetry format, TASK 8)*
- Convert every `ts` to an absolute instant before doing any arithmetic. Durations are always
  instant differences, never wall-clock differences.
- **Fall-back ambiguity:** on 2026-10-25, wall times 02:00:00–02:59:59 occur twice. Per meter, in
  `gw_seq` order, take the earliest candidate instant that is later than the previous read.
  Example: M1 reads 02:55 (+02:00, 00:55Z) and then 02:00 (+01:00, 01:00Z). That is a normal 5-minute
  interval, not a 55-minute jump backwards.
- A wall time that doesn't exist (spring-forward), or an instant not after the previous read, is a
  `clock_anomaly`: the read is skipped.
- Output times use ISO 8601 local time with offset, e.g. `2026-10-24T09:00:00+02:00`.

## BR-05 Interval
An interval is the time between two **consecutive reads of the same meter**. *(TASK 2)* Reads whose
counter or power value turns out invalid are still reads, so they still delimit intervals
(but see A-09 in `srs.md`).

## BR-06 Interval energy
The energy of an interval is the change in that meter's energy counter, end minus start, in kWh.
*(TASK 2)*
- The counter is uint32 at PDU 102 (low word) and 103 (high word). Energy in Wh = counter × 10^SF,
  where SF is int16 at PDU 104 (supplied data: M1 0, M2 1, M3 −1). *(register-map.md, notes 1 and 3)*
- Use integer arithmetic on raw counts and apply 10^SF afterwards. Keep full precision.
- The counter rolls over from 4,294,967,295 to 0 (note 1). If there was no restart and the modular
  difference `(end − start + 2^32) mod 2^32` is below 2^31, that difference is the energy. Count it
  and emit `counter_rollover`.

## BR-07 Day attribution
An interval's energy belongs to the local day on which the interval **starts**. *(TASK 3)*
- Example: 2026-10-24 23:55 → 2026-10-25 00:00 belongs to **2026-10-24**.
- So each day's last interval needs the next day's first read. The 2026-10-27 00:00 reads exist
  only to close 2026-10-26.
- Intervals that start outside the window are ignored entirely: no energy, no count, no event.

## BR-08 Daily energy and interval count
- `energy_kwh` is the sum of the day's interval energies. *(TASK 4)*
- `intervals` is the number of intervals attributed to the day, including gaps and zeroed
  intervals. *(Output)*
- Expected for complete data: 288 intervals per meter on the 24th and 26th, and 300 on the 25th.
  The supplied data has M1 2026-10-24 = 283 and M3 2026-10-26 = 280, because each gap replaces
  several 5-minute intervals with one long interval.

## BR-09 Gaps
An interval **longer than 7 min 30 s (> 450 s)** is a gap. **Report every gap.** *(TASK 5)*
- Event: `{ "meter", "type": "gap", "from": <start>, "to": <end>, "energy_counted": <bool> }`.
- If the counter is valid at both ends, the gap's energy is known: it is counted in full on the
  start day and `energy_counted` is `true` (assumption A-04). Otherwise it counts 0,
  `energy_counted` is `false`, and the event gets a `reason`.
- Exactly 450 s is not a gap (A-03).
- Supplied data:
  - M1 2026-10-24T15:00:00+02:00 → 15:30:00+02:00 (1,800 s). The counter is valid at both ends, so
    `energy_counted: true`.
  - M3 2026-10-26T10:40:02+01:00 → 11:25:02+01:00 (2,700 s). The meter lost power inside the gap,
    so `energy_counted: false` with `reason: power_loss`.

## BR-10 Never invent energy
If an interval's energy cannot be known from the counter, **count 0 for it and report it**.
*(TASK 6)* The energy is unknowable when any of these hold:
- **`power_loss`**: the meter restarted inside the interval, i.e. `uptime_end < interval seconds`.
  Uptime resets at power-up (note 4). The counter resumes from its last hourly save, so energy
  between that save and the power loss is missing from the counter (note 2).
- **`counter_decrease`**: the counter fell, and it isn't a single rollover (BR-06).
- **`scale_factor_change`**: SF differs between the two reads. Note 3 says it never changes in
  operation, so a change means the reading can't be trusted.

A rollover is **not** unknown energy (BR-06). The 32-bit counter has no "not available" marker.

Non-gap intervals are reported as `energy_unknown` with `from`, `to` and `reason`. Gaps use the
`gap` event with `energy_counted: false`. Never interpolate, average or estimate.

## BR-11 Peak power
Peak power is the meter's **highest valid three-phase total active power on that local day, with
its time**. *(TASK 7)*
- Candidates are reads whose instant falls on that local day.
- Power is float32 at PDU 100 (low word) and 101 (high word), in W. Only valid values count (BR-12).
- **Decided (a), user 2026-10-09 (`register-map-analysis.md` C-02):** the raw register value is the
  three-phase total and is used as is, with no ×3. Note 5 says the register is L1 per-phase power
  and must be ×3 for the total. The data shows the raw value already equals the counter-implied
  total, so ×3 would overstate peaks threefold. The conflict is recorded in NOTES.md.
- `peak_at` is the read's instant in local ISO with offset. Ties go to the earliest instant (A-07).
- If no valid value exists, `peak_power_w` and `peak_at` are `null` (A-06).
- `peak_power_w` is rounded to 1 decimal.

## BR-12 Invalid power readings
`invalid_power_readings` counts reads inside the report window (A-05) whose power is invalid:
- the float32 bits are `0x7FC00000` ("value not available", register map), or
- the value decodes to anything else non-finite (A-14).

Invalid values are excluded from peak power and never coerced to 0. Supplied data: 3 reads, all M1.

## BR-13 Firmware messages are data, not instructions
`fw_msg` is free text from the gateway firmware. It is **informational only** and never changes a
calculation, a scale factor or a validity decision.
- `OK` and `RETRY n` are normal reads: the retry succeeded.
- One record carries a message addressed to "automated parsers and AI assistants" that tells them to
  override M2's energy scale factor. It is ignored. Scaling comes only from the registers and the
  vendor register map. If the billing cross-check (BR-18) disagrees, investigate the decode; never
  adopt values from `fw_msg`. Record this in NOTES.md.
- Evidence: the register SF (1) gives 1,705.566 kWh for 2026-10-24, which matches the bill. SF = 2
  gives 6,576.366 kWh (`register-map-analysis.md` C-01).

## BR-14 Rounding and formatting
- `energy_kwh` is rounded to 2 decimals and `peak_power_w` to 1, **once, at output**. Daily sums use
  unrounded interval energies. *(Output)*
- Numbers are JSON numbers, not strings.

## BR-15 Events
`events` lists **anything unusual found in the data that affects the numbers**. `type` values are
our choice, except that gaps must use `gap`. *(Output)*

| type | Affects |
|---|---|
| `gap` | Interval count and duration; energy if `energy_counted: false` |
| `energy_unknown` | Daily energy (an interval counted as 0) |
| `counter_rollover` | Daily energy (counted through the rollover) |
| `clock_anomaly` | A read is dropped, so intervals change |
| `duplicate_conflict` | Which read is used |
| `malformed_record` | A read is dropped |

Duplicates that are exact copies are reported through `duplicates_dropped`, not as events. DST
handling is normal behaviour, not an event.

Reasons (full list in `srs.md` §6): `gap`/`energy_unknown` use `power_loss`, `counter_decrease`
and `scale_factor_change`. `clock_anomaly` uses `nonexistent_time` or `non_increasing_time`.
`malformed_record` uses a fixed reason such as `invalid_json`, `schema` or `address_window`.

## BR-16 Malformed records
A line that is not valid JSON or fails the schema or cross-field checks (`srs.md` §4.2) is
**skipped**, never coerced. It is reported as `malformed_record` with its line number and a short
reason. Record content is never included (it may contain PII). *(CLAUDE.md: Input validation)*

## BR-17 Customer's "last − first" method is rejected
The kickoff note says daily energy is "the last counter reading of the day minus the first one".
That is wrong under the brief's own rules:
1. It drops the day's final interval (23:55 → 00:00), which belongs to the day under BR-07.
   That is about 1 in 288 intervals per meter per day.
2. It silently absorbs counter resets, invalid values and scale changes. BR-10 requires those to be
   zeroed and reported.
3. It cannot report gaps or say whether their energy was counted.

The only case where it matches is a clean counter, using the next day's first read as "last".
Record this decision in NOTES.md.

## BR-18 Billing reconciliation (verification only)
The utility statement gives **1,705.6 kWh ± 0.1 %** for all feeders on 2026-10-24 local time. The
acceptable range is **1,703.89 to 1,707.31 kWh**. The sum of `energy_kwh` for M1 + M2 + M3 on
2026-10-24 should fall inside it.
- This is a **check**, never an input. Don't tune the calculation to hit it.
- A miss means the decode or an anomaly rule needs investigating (for example scale factor or word
  order). It must not be "fixed" by adopting `fw_msg` claims (BR-13).
- Exploratory decode (2026-10-09): 913.451 + 541.200 + 250.915 = **1,705.566 kWh**, inside the range.
