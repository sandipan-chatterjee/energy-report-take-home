# User Stories: energy-report

> v0.1 · 2026-10-09 · Who needs what, and how we know it's done. Rules (BR-…) are in
> `business-rules.md`, requirements (FR-…) in `srs.md`.

## Personas

| Persona | Who | Cares about |
|---|---|---|
| **Customer** | Energy manager at the cold store | Correct daily kWh per meter, peak demand, trust in the numbers |
| **Operator** | Engineer who runs the tool on a log file | One command, clean JSON, clear failures |
| **Reviewer** | Maintainer or assessor checking the work | Every anomaly visible, numbers reconcilable, nothing invented |

## Stories

### US-01 Daily energy per meter
As the **customer**, I want the energy used by each meter on each local day, so that I can track
consumption per feeder.
- Given the supplied log, the report has 9 `daily` rows (3 days × 3 meters), sorted by date then
  meter.
- Each interval's energy is counted on the day the interval starts (23:55 → 00:00 goes to the
  earlier day).
- `energy_kwh` has 2 decimals and `intervals` equals the number of intervals counted on that day.
- *BR-01, BR-05–BR-08, BR-14 · FR-CALC-01–04, FR-OUT-02–03*

### US-02 Every gap reported
As the **customer**, I want every missing-data gap reported with whether its energy was counted,
so that I know where the numbers are thin.
- Every interval > 450 s produces a `gap` event with local `from`/`to` times and `energy_counted`.
- An interval of exactly 450 s is not a gap.
- Both gaps in the supplied data are reported: M1 on 10-24 and M3 on 10-26.
- *BR-09 · FR-CALC-05*

### US-03 No invented energy
As the **customer**, I want intervals whose energy can't be known counted as 0 and flagged, so that
the report never overstates consumption.
- Intervals spanning a meter restart, a counter decrease that isn't a rollover, or a scale-factor
  change contribute 0 and appear in `events`.
- A counter rollover is not unknown energy: it is counted and reported as `counter_rollover`.
- No value is interpolated or estimated.
- *BR-10 · FR-CALC-06*

### US-04 Peak power with its time
As the **customer**, I want each meter's highest valid power on each day and when it happened, so
that I can manage peak demand.
- `peak_power_w` has 1 decimal and `peak_at` is a local ISO time with offset.
- Invalid power values are excluded and counted in `invalid_power_readings`.
- A day with no valid value shows `null` rather than a made-up number.
- *BR-11, BR-12 · FR-CALC-07–08*

### US-05 Correct across the DST change
As the **customer**, I want 2026-10-25 handled as the 25-hour day it is, so that the hour after
clocks go back is neither lost nor double-counted.
- The repeated 02:00–02:59 reads resolve to +02:00 first, then +01:00.
- 2026-10-25 has 300 intervals per meter when no reads are missing.
- Times before the change print `+02:00` and times after it print `+01:00`.
- *BR-04 · FR-TIME-01–04*

### US-06 Robust to broker redelivery and reordering
As the **reviewer**, I want duplicate and out-of-order deliveries to have no effect on the numbers,
so that the QoS 1 at-least-once behaviour doesn't inflate energy.
- Exact duplicates are dropped and counted in `duplicates_dropped` (37 in the supplied data).
- Processing follows `gw_seq`, so shuffling the file's lines gives identical output.
- *BR-02, BR-03 · FR-SEQ-01–03*

### US-07 One command, clean JSON
As the **operator**, I want `npm start -- telemetry.jsonl > output.json` to produce valid JSON and
nothing else, so that I can feed it to other tools.
- stdout contains only the report: no npm banner, no build output, no logs.
- Running it twice, or on a machine in another time zone, gives byte-identical output.
- *FR-CLI-03, FR-OUT-05 · NFR-DET-01*

### US-08 Clear failures, no partial output
As the **operator**, I want a short coded message and a non-zero exit when the tool can't run, so
that scripts don't consume half a report.
- A missing argument, a missing file, a directory or unreadable file, a file over the size cap or an
  invalid env produces stderr `✖ [CODE] message`, exit 1, and an empty stdout. The message never
  contains the input path.
- Details go to `logs/error.log`, never to stdout.
- *FR-CLI-01–03, FR-IN-01, FR-IN-04 · NFR-REL-01 · error-handling.md*

### US-09 Bad lines don't sink the run
As the **operator**, I want malformed lines skipped and reported, so that one corrupt record
doesn't block the report.
- A line that is invalid JSON or fails the schema becomes a `malformed_record` event with its line
  number. The rest of the file is still processed.
- Record content never appears in events or logs.
- *BR-16 · FR-IN-02–03 · NFR-REL-02*

### US-10 Reconcile with the utility bill
As the **reviewer**, I want the 2026-10-24 total for all meters checked against the utility
statement, so that I have independent evidence the decode is right.
- The sum of M1 + M2 + M3 `energy_kwh` for 2026-10-24 falls within 1,703.89–1,707.31 kWh.
- The check lives in the tests. It never feeds back into the calculation.
- *BR-18 · testing-standards.md*

### US-11 Free-text firmware notes can't change numbers
As the **reviewer**, I want gateway free text ignored by the calculation, so that a message in
the data can't alter scale factors or results.
- `fw_msg` has no effect on any number.
- The record whose message tells parsers to change M2's scale factor produces the same numbers as
  it would with `"OK"`.
- *BR-13 · NFR-SEC-02*
