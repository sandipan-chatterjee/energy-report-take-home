import { copyFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'dist', 'cli', 'index.js');
const INPUT = path.join(ROOT, 'input', 'telemetry.jsonl');
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface DailyRow {
  date: string;
  meter: string;
  energy_kwh: number;
  intervals: number;
  peak_power_w: number | null;
  peak_at: string | null;
}

interface ReportShape {
  site_timezone: string;
  daily: DailyRow[];
  events: Record<string, string | number | boolean>[];
  duplicates_dropped: number;
  invalid_power_readings: number;
}

function runCli(args: string[], env: Record<string, string> = {}): CliResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'silent', ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseReport(stdout: string): ReportShape {
  return JSON.parse(stdout) as ReportShape;
}

function expectFailure(result: CliResult, code: string, secret?: string): void {
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`✖ [${code}]`);
  if (secret !== undefined) expect(result.stderr).not.toContain(secret);
}

let tmp = '';
let base: CliResult;
let report: ReportShape;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'energy-report-it-'));
  base = runCli(['telemetry.jsonl']);
  report = parseReport(base.stdout);
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('report on the supplied telemetry', () => {
  it('exits 0 with JSON on stdout and no error on stderr', () => {
    expect(base.status).toBe(0);
    expect(base.stderr).not.toContain('✖');
    expect(base.stdout.endsWith('}\n')).toBe(true);
  });

  it('has the top-level keys in order and the site time zone', () => {
    expect(Object.keys(report)).toEqual([
      'site_timezone',
      'daily',
      'events',
      'duplicates_dropped',
      'invalid_power_readings',
    ]);
    expect(report.site_timezone).toBe('Europe/Berlin');
  });

  it('has 9 rows with the expected energy, intervals, peak and peak time', () => {
    expect(report.daily).toEqual([
      {
        date: '2026-10-24',
        meter: 'M1',
        energy_kwh: 913.45,
        intervals: 283,
        peak_power_w: 48085.5,
        peak_at: '2026-10-24T14:25:00+02:00',
      },
      {
        date: '2026-10-24',
        meter: 'M2',
        energy_kwh: 541.2,
        intervals: 288,
        peak_power_w: 31963.3,
        peak_at: '2026-10-24T13:15:01+02:00',
      },
      {
        date: '2026-10-24',
        meter: 'M3',
        energy_kwh: 250.92,
        intervals: 288,
        peak_power_w: 19359.6,
        peak_at: '2026-10-24T10:20:02+02:00',
      },
      {
        date: '2026-10-25',
        meter: 'M1',
        energy_kwh: 945.35,
        intervals: 300,
        peak_power_w: 71250.5,
        peak_at: '2026-10-25T02:35:00+01:00',
      },
      {
        date: '2026-10-25',
        meter: 'M2',
        energy_kwh: 552.29,
        intervals: 300,
        peak_power_w: 31838.8,
        peak_at: '2026-10-25T13:15:01+01:00',
      },
      {
        date: '2026-10-25',
        meter: 'M3',
        energy_kwh: 253.93,
        intervals: 300,
        peak_power_w: 19157.7,
        peak_at: '2026-10-25T15:55:02+01:00',
      },
      {
        date: '2026-10-26',
        meter: 'M1',
        energy_kwh: 910.66,
        intervals: 288,
        peak_power_w: 47138.9,
        peak_at: '2026-10-26T15:05:00+01:00',
      },
      {
        date: '2026-10-26',
        meter: 'M2',
        energy_kwh: 539.11,
        intervals: 288,
        peak_power_w: 31747.7,
        peak_at: '2026-10-26T18:05:01+01:00',
      },
      {
        date: '2026-10-26',
        meter: 'M3',
        energy_kwh: 238.01,
        intervals: 280,
        peak_power_w: 19262.6,
        peak_at: '2026-10-26T18:05:02+01:00',
      },
    ]);
  });

  it('has exactly the three expected events', () => {
    expect(report.events).toEqual([
      {
        meter: 'M1',
        type: 'gap',
        from: '2026-10-24T15:00:00+02:00',
        to: '2026-10-24T15:30:00+02:00',
        energy_counted: true,
      },
      {
        meter: 'M2',
        type: 'counter_rollover',
        from: '2026-10-25T04:40:01+01:00',
        to: '2026-10-25T04:45:01+01:00',
      },
      {
        meter: 'M3',
        type: 'gap',
        from: '2026-10-26T10:40:02+01:00',
        to: '2026-10-26T11:25:02+01:00',
        energy_counted: false,
        reason: 'power_loss',
      },
    ]);
  });

  it('counts 37 dropped duplicates and 3 invalid power readings', () => {
    expect(report.duplicates_dropped).toBe(37);
    expect(report.invalid_power_readings).toBe(3);
  });

  it('keeps the 2026-10-24 total inside the billing range', () => {
    const total = report.daily
      .filter((r) => r.date === '2026-10-24')
      .reduce((sum, r) => sum + r.energy_kwh, 0);
    expect(total).toBeGreaterThanOrEqual(1703.89);
    expect(total).toBeLessThanOrEqual(1707.31);
  });

  it('reports no data-quality events besides gaps and the rollover', () => {
    const types = report.events.map((e) => e.type);
    for (const type of [
      'malformed_record',
      'clock_anomaly',
      'duplicate_conflict',
      'energy_unknown',
    ]) {
      expect(types).not.toContain(type);
    }
  });
});

describe('input path handling', () => {
  it('gives identical stdout for telemetry.jsonl and input/telemetry.jsonl', () => {
    const viaInputDir = runCli(['input/telemetry.jsonl']);
    expect(viaInputDir.status).toBe(0);
    expect(viaInputDir.stderr).not.toContain('✖');
    expect(viaInputDir.stdout).toBe(base.stdout);
  });

  it('accepts an absolute path to a copy outside the repo', () => {
    const copy = path.join(tmp, 'copy.jsonl');
    copyFileSync(INPUT, copy);
    const result = runCli([copy]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(base.stdout);
  });

  it('accepts a relative path that climbs out of the repo', () => {
    const copy = path.join(tmp, 'climb.jsonl');
    copyFileSync(INPUT, copy);
    const result = runCli([path.relative(ROOT, copy)]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(base.stdout);
  });
});

describe('failure paths', () => {
  it('fails with CLI-001 and no argument', () => {
    expectFailure(runCli([]), 'CLI-001');
  });

  it('fails with CLI-002 for an extra argument', () => {
    expectFailure(runCli(['telemetry.jsonl', 'extra.jsonl']), 'CLI-002');
  });

  it('fails with CLI-002 for an unknown flag', () => {
    expectFailure(runCli(['--flag']), 'CLI-002');
    expectFailure(runCli(['--flag', 'telemetry.jsonl']), 'CLI-002');
  });

  it('fails with TEL-001 for a missing file without echoing the path', () => {
    expectFailure(runCli(['missing.jsonl']), 'TEL-001', 'missing.jsonl');
  });

  it('fails with TEL-001 for a missing absolute path', () => {
    const missing = path.join(tmp, 'absent-file.jsonl');
    expectFailure(runCli([missing]), 'TEL-001', missing);
  });

  it('fails with TEL-002 for a directory without echoing the path', () => {
    expectFailure(runCli([tmp]), 'TEL-002', tmp);
  });

  it('fails with TEL-003 for a file over the size limit', () => {
    const big = path.join(tmp, 'big.jsonl');
    writeFileSync(big, '');
    truncateSync(big, MAX_INPUT_BYTES + 1);
    expectFailure(runCli([big]), 'TEL-003', big);
  });

  it('fails with TEL-004 for a file with no valid record', () => {
    const junk = path.join(tmp, 'junk.jsonl');
    writeFileSync(junk, 'not json\n{"gw_seq":1}\n\n');
    expectFailure(runCli([junk]), 'TEL-004', junk);
  });

  it('fails with TEL-004 for an empty file', () => {
    const empty = path.join(tmp, 'empty.jsonl');
    writeFileSync(empty, '');
    expectFailure(runCli([empty]), 'TEL-004');
  });

  it('fails with CFG-001 for an invalid LOG_LEVEL', () => {
    expectFailure(runCli(['telemetry.jsonl'], { LOG_LEVEL: 'loud' }), 'CFG-001');
  });

  it('fails with CFG-001 for an invalid NODE_ENV', () => {
    expectFailure(runCli(['telemetry.jsonl'], { NODE_ENV: 'staging' }), 'CFG-001');
  });

  it('never prints a stack trace', () => {
    expect(runCli(['missing.jsonl']).stderr).not.toMatch(/\bat .*\.(js|ts):\d+/);
  });
});

describe('malformed content is reported, not fatal', () => {
  it('skips bad lines, reports them as events and still exits 0', () => {
    const good = JSON.stringify({
      gw_seq: 1,
      ts: '2026-10-24 00:00:00',
      meter: 'M1',
      unit_id: 1,
      fc: 3,
      start_addr: 100,
      qty: 7,
      regs: [0, 0x3f80, 1000, 0, 0, 500, 0],
      fw_msg: 'OK',
    });
    const file = path.join(tmp, 'mixed.jsonl');
    writeFileSync(file, `bad json\n${good}\n`);
    const result = runCli([file]);
    expect(result.status).toBe(0);
    expect(parseReport(result.stdout).events).toEqual([
      { type: 'malformed_record', line: 1, reason: 'invalid_json' },
    ]);
  });
});

describe('determinism', () => {
  it.each(['UTC', 'Asia/Kolkata', 'America/New_York'])(
    'produces byte-identical stdout under TZ=%s',
    (tz) => {
      const result = runCli(['telemetry.jsonl'], { TZ: tz });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(base.stdout);
    },
  );
});

describe('npm start', () => {
  it('writes pure JSON to stdout with no npm banner', () => {
    const result = spawnSync('npm', ['start', '--', 'telemetry.jsonl'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, LOG_LEVEL: 'silent' },
      timeout: 120_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.startsWith('{')).toBe(true);
    expect(result.stdout).not.toContain('> energy-report');
    expect(result.stdout).toBe(base.stdout);
  }, 150_000);
});
