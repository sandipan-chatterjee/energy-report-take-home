# energy-report

A command-line tool that turns raw Modbus telemetry from three PM-3 energy meters into a daily
per-meter energy report. It reads a JSON Lines file and writes the report as JSON to stdout.

The report covers local days 2026-10-24, 2026-10-25 and 2026-10-26 (Europe/Berlin), for meters
M1, M2 and M3. For each meter and day it gives energy, interval count, peak power and when it
occurred. It also lists every gap and every other data anomaly that affects the numbers.

## Requirements

- Node.js 20 or newer (see `.nvmrc`)
- npm

## Setup

```sh
npm install
```

npm output is silenced for this repo through `.npmrc`. This keeps `output.json` as pure JSON. To see
npm's own messages, add `--loglevel=notice`, for example `npm install --loglevel=notice`.

## Usage

```sh
npm start -- telemetry.jsonl > output.json
```

`npm start` builds the project first, then runs the CLI. The argument is a path to the telemetry
file. It is resolved against the current directory first, then against `input/`. Any absolute path
works too. The file must be a regular file no larger than 50 MiB.

Examples:

```sh
npm start -- input/telemetry.jsonl > output.json
npm start -- /absolute/path/to/telemetry.jsonl > output.json
```

On success the report goes to stdout and the exit code is 0. On failure, stdout stays empty, stderr
gets one line in the form `✖ [CODE] message`, and the exit code is 1.

## Output

```json
{
  "site_timezone": "Europe/Berlin",
  "daily": [
    {
      "date": "2026-10-24",
      "meter": "M1",
      "energy_kwh": 913.45,
      "intervals": 283,
      "peak_power_w": 48085.5,
      "peak_at": "2026-10-24T14:25:00+02:00"
    }
  ],
  "events": [
    {
      "type": "gap",
      "meter": "M1",
      "from": "2026-10-24T15:00:00+02:00",
      "to": "2026-10-24T15:30:00+02:00",
      "energy_counted": true
    }
  ],
  "duplicates_dropped": 37,
  "invalid_power_readings": 3
}
```

- `daily` has one row per meter per day, 9 rows in total, sorted by date and then meter.
- `energy_kwh` is rounded to 2 decimals and `peak_power_w` to 1 decimal.
- `peak_at` and all other times use ISO 8601 local time with the UTC offset.
- A day with no valid power reading has `peak_power_w` and `peak_at` set to `null`.
- `events` lists anomalies. Each has a `type`:
  - `gap`: an interval longer than 450 seconds. Includes `energy_counted`, and a `reason` when that is `false`.
  - `counter_rollover`: energy counted across the 32-bit counter wrap.
  - `energy_unknown`: an interval whose energy could not be known, counted as 0.
  - `clock_anomaly`, `duplicate_conflict`, `malformed_record`: data that was dropped or conflicted.

## How the numbers are calculated

- **Ordering:** reads are processed by `gw_seq`, not by file order or timestamp. Exact duplicates
  are dropped and counted in `duplicates_dropped`.
- **Intervals:** an interval is the span between two consecutive reads of the same meter. Its
  energy is the change in the energy counter. Energy belongs to the local day on which the interval
  starts.
- **Energy:** counter × 10^SF, using the scale factor register read for each meter.
- **Gaps:** intervals longer than 450 seconds are reported. Energy is counted only when the counter
  is valid at both ends.
- **Never invented:** if an interval's energy cannot be known, it counts 0 and is reported.
- **Time:** wall-clock times are converted to instants using Europe/Berlin rules, so the repeated
  hour on 2026-10-25 is handled correctly.
- **Register decoding** follows `.claude/docs/register-map.md`. The application of that map to
  this data is in `.claude/docs/register-map-analysis.md`.

## Verification

The total for 2026-10-24 across all three meters is 1,705.57 kWh. The utility statement gives
1,705.6 kWh ± 0.1 %, so the figures agree.

## Development

| Command                    | Purpose                                 |
| -------------------------- | --------------------------------------- |
| `npm run build`            | Compile `src/` to `dist/`               |
| `npm run typecheck`        | Type-check `src/` and `tests/`          |
| `npm run lint`             | Run ESLint with type-aware rules        |
| `npm test`                 | Build, then run all tests with coverage |
| `npm run test:unit`        | Run unit tests only                     |
| `npm run test:integration` | Build, then run integration tests       |
| `npm run format`           | Format the repo with Prettier           |

Run `npm test` without `--loglevel=notice`. npm passes that flag to child processes, and the
integration test checks that stdout is pure JSON.

### Project layout

```
src/
  cli/         entry point and the shared command wrapper
  config/      environment validation and constants
  errors/      AppError, ErrorHandler and per-module error dictionaries
  logger/      JSON Lines loggers for the app and error logs
  report/      interval calculation, daily totals, events and output formatting
  telemetry/   reading, validating and decoding input records
  types/       shared types
  utils/       time-zone helpers
tests/
  unit/        unit tests
  integration/ runs the built CLI and checks stdout, stderr and exit code
```

### Logs

- `logs/app.log`: command start and finish, timings and record counts.
- `logs/error.log`: failures, written only by the error handler.

Both are JSON Lines and git-ignored. Log level is set by `LOG_LEVEL` (`debug`, `info`, `warn`,
`error` or `silent`). The default is `info`.

## Documentation

Project rules and specifications live in `.claude/docs/`:

- `TASK.md`: the brief.
- `srs.md`: requirements.
- `business-rules.md`: domain rules.
- `architecture.md`: design and decisions.
- `register-map.md` and `register-map-analysis.md`: register decoding.
- `requirements-traceability-matrix.md`: requirements mapped to code and tests.

`CLAUDE.md` holds the coding and security rules that apply to all work in this repo.

## Open decision

The vendor's register map (note 5) says the power register is per phase and must be multiplied by 3.
The data shows the register already matches the three-phase total. The current code reports the raw
register value as `peak_power_w`. This is recorded as conflict C-02 in
`.claude/docs/register-map-analysis.md`, and it is waiting for a decision.
