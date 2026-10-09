# Plan — energy-report CLI (architecture prompt execution)

## Context

User handed over `.claude/prompts/initial-architechture-prompt.md`: scaffold a strict-TS CLI with
error dictionaries, logging, 4 subagents, `/build` pipeline, commit-block — then implement the tool
from `.claude/docs/TASK.md` (daily energy report per meter from `input/telemetry.jsonl`, JSON to stdout).
Repo today: empty `src/`, `output/`, `NOTES.md`, `.gitignore`; no `package.json`; not a git repo;
Node v22.18 locally (task requires 20+). Existing `CLAUDE.md` holds security rules that must be kept.

## Pre-flight restatement (section 1)

- **Purpose:** `npm start -- telemetry.jsonl > output.json` → per-meter (M1–M3) daily report for local
  days 2026-10-24/25/26 (Europe/Berlin): energy_kwh (2dp), intervals, peak_power_w (1dp) + peak_at,
  `events` (gaps + anything affecting numbers), `duplicates_dropped`, `invalid_power_readings`.
- **In scope:** one command, file in → JSON out, tests. **Out of scope:** DB, network, editing data files.
- Customer's "last − first of day" is wrong (interval starting 23:55 belongs to that day; resets/gaps).

## Data facts found (profiled read-only)

- 2655 records, all parse, all same 9 keys/types. Shapes: M1/M2 `fc3 sa100 q7`, M3 `fc3 sa99 q8`
  (M3 reads one extra register _before_ 100 → map regs by address, not index).
- 37 duplicate `gw_seq`, all byte-identical (QoS 1 redelivery) → drop, count.
- 244 out-of-order deliveries → sort by `gw_seq`. No `gw_seq` holes after dedupe.
- DST fall-back 2026-10-25: 02:00–02:59 appears twice; `ts` goes backwards once at seq 50967→50968.
  Resolve ambiguity by gw_seq order (first pass +02:00, second +01:00). 10-25 has 300 intervals.
- Gaps (>450 s): M1 10-24 15:00→15:30, M3 10-26 10:40→11:25. M2 complete (877 reads).
- `fw_msg`: `OK` ×2605, `RETRY 1` ×49, one free-text message asserting an M2 scale-factor override.
  `fw_msg` is untrusted free text: never drives calculations; scale factors come only from registers.
- Billing excerpt: 10-24 all feeders = 1705.6 kWh ±0.1 % → verification target for the 10-24 sum.

## Decisions (from user)

- **Register map:** user will paste `register-map.md` (currently empty). Steps A–C run now; **step D
  pauses until it's filled.** Other empty docs (srs, architecture, business-rules…) are unneeded; RTM is
  a template from an unrelated project → ignored.
- **Deps (approved):** runtime `zod`; dev `typescript`, `@types/node`, `jest`, `ts-jest`, `@types/jest`,
  `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`. Exact pins, `npm audit` after install.
  CLI args via `node:util` `parseArgs`; logs via small JSON-lines writer (no commander/pino).
- **Jest ⇒ CommonJS** (no `"type": "module"`): Jest's ESM mode is still experimental; ts-jest + CJS is
  the boring path.
- **Prettier hook fix:** hook reads `.tool_input.file_path` from stdin via `jq`, only formats files under
  `$CLAUDE_PROJECT_DIR`, calls `node_modules/.bin/prettier --write --ignore-unknown` directly (no npx
  download), no-ops if prettier isn't installed yet.

## Approach

### A. Scaffold (section 3–4)

- `package.json` (CommonJS, `engines.node >=20`), `.nvmrc` = 20, `tsconfig.json` (strict +
  noImplicitAny, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noFallthroughCasesInSwitch),
  `tsconfig.build.json` (src only → dist), `eslint.config.js`, `jest.config.js` (ts-jest preset,
  node env), `.prettierrc`.
- ESLint: `no-explicit-any`, `no-restricted-syntax` on `TSUnknownKeyword`. **Prompt correction:**
  `@typescript-eslint/ban-types` was removed in typescript-eslint v8 → use `no-unsafe-function-type`,
  `no-wrapper-object-types`, `no-empty-object-type` (+ restricted-syntax for `object` keyword).
- No `unknown` keyword needed anywhere: catch vars narrowed with `instanceof`; `JSON.parse` output goes
  straight into zod `.safeParse()`.
- Scripts: `build`, `typecheck`, `lint`, `test` (`jest --coverage`), `test:unit` (`jest tests/unit`),
  `test:integration` (build, then `jest tests/integration`), `start` (prestart build →
  `node dist/cli/index.js`), `dev`, `format`.
- `.gitignore`: node_modules, dist, logs, coverage, .env*.

### B. Infra (section 5–6)

- `src/errors/app-error.ts`, `error-handler.ts` (singleton, logs to error logger, prints
  `✖ [CODE] msg` to stderr, exit 1), `modules/{cli,config,telemetry,report,system}.errors.ts`
  (`CLI-`, `CFG-`, `TEL-`, `RPT-`, `SYS-`).
- `src/cli/run-command.ts`: one shared try/catch → `errorHandler.handle(e instanceof Error ? e : …)`.
- `src/config/{env,constants,index}.ts`: env = zod-parsed `NODE_ENV`, `LOG_LEVEL` (only reader of
  `process.env`); constants = timezone, report days, 450 s gap threshold, register addresses, paths,
  exit codes, rounding.
- `src/logger/{logger,error-logger}.ts` → `logs/app.log`, `logs/error.log` (JSON lines, dir created on
  start). Error logs carry code/module/line-number only — never record contents (PII rule).
- Note: writing `logs/` departs from CLAUDE.md least-privilege ("stdout/stderr only") but is
  explicitly requested by the prompt → allowed; documented in CLAUDE.md.

### C. Docs & agent config (section 2, 7–9)

- Rewrite `CLAUDE.md`: keep existing Security Rules verbatim; add overview, commands, stack, tree,
  type rules, error handling, logging, agents & pipeline, commit policy.
- `.claude/agents/{developer,quality-checker,tester,security-reviewer}.md`, `.claude/commands/build.md`.
- Merge into existing `.claude/settings.json` deny: `Bash(git commit:*)`, `Bash(git commit --amend:*)`
  (`git push` already denied); replace the broken prettier hook (see Decisions). Tester agent prompt
  says Jest, not Vitest.
- Custom agent files load at session start → for this session, run the pipeline via general-purpose
  agents seeded with each agent file's prompt (or restart session after step C).

### D. Feature — via pipeline (developer → quality-checker → tester → security-reviewer)

**Gate: starts only after `register-map.md` is filled.** Decode/anomaly rules below get finalized
against it (and any contradiction with TASK.md is raised before coding).
Modules: `src/telemetry/` (read + validate + decode), `src/report/` (compute), `src/utils/time.ts`.

1. **Input path:** arg resolved with `path.resolve` (cwd-relative, then `input/`-relative); must land
   inside `input/` else `CLI-` error. So both `telemetry.jsonl` and `input/telemetry.jsonl` work.
2. **Parse:** split lines, skip blank, `JSON.parse` in try/catch, zod schema per record; malformed →
   skip + `malformed_record` event (line no. only).
3. **Dedupe** by `gw_seq` (identical → `duplicates_dropped++`; conflicting content → event, keep first).
   **Sort** by `gw_seq`.
4. **Decode** regs by address per register map (shape check: `regs.length === qty`, fc/unit_id/meter
   consistency).
5. **Time:** Berlin wall time → instant via `Intl.DateTimeFormat` (stdlib, no tz lib); ambiguous hour
   resolved by gw_seq monotonicity; output ISO with offset.
6. **Intervals** per meter between consecutive valid reads; energy = scaled counter delta; attributed to
   local day of interval start; gap if > 450 s (`gap` event, `energy_counted` = whether counter valid
   both ends). Counter unknown (reset/wrap/invalid/scale change — exact rules per register map) → 0 +
   event.
7. **Peak:** max valid total active power per meter per local day + time; invalid sentinels counted in
   `invalid_power_readings`.
8. Output 9 `daily` rows, rounded at output only.

### E. Wrap-up

- Generate `output.json` via `npm start -- telemetry.jsonl > output.json`.
- Collect for the user's `NOTES.md`: ambiguities/decisions, every AI mistake caught (incl. prompt's
  stale `ban-types`), verification done/not done. User writes/owns NOTES.md.
- No `git init`/commit — user does that.

## Verification

- `npm run typecheck && npm run lint && npm test` all green.
- Unit: time conversion around DST (both 02:30s), dedupe/sort, interval attribution at midnight, gap
  detection at 450/451 s, counter anomaly → 0 + event, invalid power, every error-dictionary entry,
  ErrorHandler (mock exit/stderr).
- Integration: spawn built CLI on `input/telemetry.jsonl` → 9 daily rows, 300 intervals on 10-25,
  288 others (minus gap shortfall), 2 gap events, `duplicates_dropped` = 37; failure paths: no arg,
  `../package.json` traversal, missing file → stderr + exit 1, empty stdout.
- Cross-check: Σ energy_kwh for 10-24 (M1+M2+M3) vs billing 1705.6 kWh ±0.1 %.
- `npm audit` clean (high/critical).
