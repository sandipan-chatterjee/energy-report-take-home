import { buildReport } from '../../src/report/build-report';
import { formatReport } from '../../src/report/format';
import type { DayTotals, IntervalEvent, ReportTotals } from '../../src/types/report';
import type { TelemetryFinding } from '../../src/types/telemetry';

const EMPTY = buildReport([]);

function withDay(overrides: Partial<DayTotals>): ReportTotals {
  const [first, ...rest] = EMPTY.days;
  if (first === undefined) throw new Error('no days');
  return { ...EMPTY, days: [{ ...first, ...overrides }, ...rest] };
}

function withEvents(events: IntervalEvent<number>[]): ReportTotals {
  return { ...EMPTY, events };
}

const T = (iso: string): number => Date.parse(iso);

describe('formatReport', () => {
  it('orders the top-level keys', () => {
    expect(Object.keys(formatReport(EMPTY, [], 0))).toEqual([
      'site_timezone',
      'daily',
      'events',
      'duplicates_dropped',
      'invalid_power_readings',
    ]);
  });

  it('orders the keys of a daily row', () => {
    const row = formatReport(EMPTY, [], 0).daily[0];
    expect(Object.keys(row ?? {})).toEqual([
      'date',
      'meter',
      'energy_kwh',
      'intervals',
      'peak_power_w',
      'peak_at',
    ]);
  });

  it('emits 9 sorted rows with null peaks when there is no data', () => {
    const report = formatReport(EMPTY, [], 0);
    expect(report.site_timezone).toBe('Europe/Berlin');
    expect(report.daily).toHaveLength(9);
    expect(report.daily.map((r) => `${r.date} ${r.meter}`)).toEqual(
      [...report.daily.map((r) => `${r.date} ${r.meter}`)].sort(),
    );
    expect(report.daily[0]).toEqual({
      date: '2026-10-24',
      meter: 'M1',
      energy_kwh: 0,
      intervals: 0,
      peak_power_w: null,
      peak_at: null,
    });
  });

  it('rounds energy to 2 decimals and power to 1 decimal', () => {
    const row = formatReport(
      withDay({ energyKwh: 0.125, peak: { powerW: 100.26, at: T('2026-10-24T12:00:00+02:00') } }),
      [],
      0,
    ).daily[0];
    expect(row?.energy_kwh).toBe(0.13);
    expect(row?.peak_power_w).toBe(100.3);
    expect(row?.peak_at).toBe('2026-10-24T12:00:00+02:00');
  });

  it('rounds down below the half and rounds once from the full value', () => {
    const row = formatReport(
      withDay({ energyKwh: 1.2349999, peak: { powerW: 100.2499, at: 0 } }),
      [],
      0,
    ).daily[0];
    expect(row?.energy_kwh).toBe(1.23);
    expect(row?.peak_power_w).toBe(100.2);
  });

  it('passes the counters through', () => {
    const report = formatReport({ ...EMPTY, invalidPowerReadings: 4 }, [], 9);
    expect(report.duplicates_dropped).toBe(9);
    expect(report.invalid_power_readings).toBe(4);
  });

  it('orders events: malformed by line, then by gw_seq and type, then interval events', () => {
    const findings: TelemetryFinding[] = [
      { meter: 'M1', type: 'duplicate_conflict', gw_seq: 10 },
      { type: 'malformed_record', line: 5, reason: 'schema' },
      { meter: 'M2', type: 'clock_anomaly', gw_seq: 10, reason: 'nonexistent_time' },
      { type: 'malformed_record', line: 2, reason: 'invalid_json' },
      { meter: 'M3', type: 'clock_anomaly', gw_seq: 3, reason: 'non_increasing_time' },
    ];
    const events = withEvents([
      { meter: 'M1', type: 'counter_rollover', from: T('2026-10-25T04:00:00+01:00'), to: 0 },
    ]);
    const types = formatReport(events, findings, 0).events.map((e) =>
      e.type === 'malformed_record' ? `malformed:${String(e.line)}` : e.type,
    );
    expect(types).toEqual([
      'malformed:2',
      'malformed:5',
      'clock_anomaly',
      'clock_anomaly',
      'duplicate_conflict',
      'counter_rollover',
    ]);
    const bySeq = formatReport(EMPTY, findings, 0).events.flatMap((e) =>
      'gw_seq' in e ? [e.gw_seq] : [],
    );
    expect(bySeq).toEqual([3, 10, 10]);
  });

  it('orders interval events by start, then meter, then type, as local ISO text', () => {
    const early = T('2026-10-24T10:00:00+02:00');
    const late = T('2026-10-24T11:00:00+02:00');
    const to = T('2026-10-24T12:00:00+02:00');
    const report = formatReport(
      withEvents([
        { meter: 'M1', type: 'gap', from: late, to, energy_counted: true },
        { meter: 'M2', type: 'counter_rollover', from: early, to },
        { meter: 'M1', type: 'gap', from: early, to, energy_counted: true },
        { meter: 'M1', type: 'counter_rollover', from: early, to },
      ]),
      [],
      0,
    );
    expect(
      report.events.map((e) => (e.type === 'malformed_record' ? '' : `${e.meter} ${e.type}`)),
    ).toEqual(['M1 counter_rollover', 'M1 gap', 'M2 counter_rollover', 'M1 gap']);
    expect(report.events[0]).toEqual({
      meter: 'M1',
      type: 'counter_rollover',
      from: '2026-10-24T10:00:00+02:00',
      to: '2026-10-24T12:00:00+02:00',
    });
  });

  it('keeps the reason on a gap whose energy was not counted', () => {
    const report = formatReport(
      withEvents([
        {
          meter: 'M3',
          type: 'gap',
          from: T('2026-10-26T10:40:02+01:00'),
          to: T('2026-10-26T11:25:02+01:00'),
          energy_counted: false,
          reason: 'power_loss',
        },
      ]),
      [],
      0,
    );
    expect(report.events).toEqual([
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
});
