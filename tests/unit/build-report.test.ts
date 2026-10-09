import { buildReport } from '../../src/report/build-report';
import { formatReport } from '../../src/report/format';
import { parseTelemetry } from '../../src/telemetry/parse';
import { resolveReadings } from '../../src/telemetry/readings';
import type { DayTotals, Report } from '../../src/types/report';
import type { MeterId, Reading } from '../../src/types/telemetry';

interface ReadingOptions {
  meter?: MeterId;
  counter?: number;
  sf?: number;
  uptimeS?: number;
  powerW?: number | null;
}

let seq = 0;

function at(iso: string, options: ReadingOptions = {}): Reading {
  seq += 1;
  return {
    gwSeq: seq,
    meter: options.meter ?? 'M1',
    at: Date.parse(iso),
    powerW: options.powerW === undefined ? 100 : options.powerW,
    counter: options.counter ?? 0,
    sf: options.sf ?? 0,
    uptimeS: options.uptimeS ?? 1_000_000,
  };
}

function day(readings: Reading[], date: string, meter: MeterId = 'M1'): DayTotals {
  const found = buildReport(readings).days.find((d) => d.date === date && d.meter === meter);
  if (found === undefined) throw new Error('day missing');
  return found;
}

describe('buildReport energy', () => {
  it.each([
    [0, 1],
    [1, 10],
    [-1, 0.1],
  ])('applies scale factor %i to a 1000-count delta', (sf, kwh) => {
    const totals = day(
      [
        at('2026-10-24T10:00:00+02:00', { counter: 5000, sf }),
        at('2026-10-24T10:05:00+02:00', { counter: 6000, sf }),
      ],
      '2026-10-24',
    );
    expect(totals.energyKwh).toBeCloseTo(kwh, 9);
    expect(totals.intervals).toBe(1);
  });

  it('sums consecutive intervals', () => {
    const totals = day(
      [
        at('2026-10-24T10:00:00+02:00', { counter: 0 }),
        at('2026-10-24T10:05:00+02:00', { counter: 1000 }),
        at('2026-10-24T10:10:00+02:00', { counter: 3000 }),
      ],
      '2026-10-24',
    );
    expect(totals.energyKwh).toBeCloseTo(3, 9);
    expect(totals.intervals).toBe(2);
  });

  it('attributes a 23:55 to 00:00 interval to its start day', () => {
    const readings = [
      at('2026-10-24T23:55:00+02:00', { counter: 0 }),
      at('2026-10-25T00:00:00+02:00', { counter: 2000 }),
    ];
    expect(day(readings, '2026-10-24').energyKwh).toBeCloseTo(2, 9);
    expect(day(readings, '2026-10-24').intervals).toBe(1);
    expect(day(readings, '2026-10-25').intervals).toBe(0);
    expect(day(readings, '2026-10-25').energyKwh).toBe(0);
  });

  it('adds nothing for the first read of a meter', () => {
    expect(buildReport([at('2026-10-24T10:00:00+02:00')]).events).toEqual([]);
  });

  it('keeps meters separate', () => {
    const readings = [
      at('2026-10-24T10:00:00+02:00', { meter: 'M1', counter: 0 }),
      at('2026-10-24T10:00:01+02:00', { meter: 'M2', counter: 999_999 }),
      at('2026-10-24T10:05:00+02:00', { meter: 'M1', counter: 1000 }),
      at('2026-10-24T10:05:01+02:00', { meter: 'M2', counter: 1_000_999 }),
    ];
    expect(day(readings, '2026-10-24', 'M1').energyKwh).toBeCloseTo(1, 9);
    expect(day(readings, '2026-10-24', 'M2').energyKwh).toBeCloseTo(1, 9);
  });
});

describe('buildReport gaps and unknown energy', () => {
  it('emits no gap at 450 s', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00'),
      at('2026-10-24T10:07:30+02:00', { counter: 100 }),
    ]);
    expect(result.events).toEqual([]);
  });

  it('emits a gap at 451 s with the energy counted', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00'),
      at('2026-10-24T10:07:31+02:00', { counter: 1000 }),
    ]);
    expect(result.events).toEqual([
      {
        meter: 'M1',
        type: 'gap',
        from: Date.parse('2026-10-24T10:00:00+02:00'),
        to: Date.parse('2026-10-24T10:07:31+02:00'),
        energy_counted: true,
      },
    ]);
    expect(result.days[0]?.energyKwh).toBeCloseTo(1, 9);
  });

  it('counts a power-loss gap interval but adds no energy', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { counter: 5000 }),
      at('2026-10-24T10:45:00+02:00', { counter: 4000, uptimeS: 100 }),
    ]);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'gap', energy_counted: false, reason: 'power_loss' }),
    ]);
    expect(result.days[0]?.energyKwh).toBe(0);
    expect(result.days[0]?.intervals).toBe(1);
  });

  it('reports a restart inside a normal interval as energy_unknown power_loss', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { counter: 5000 }),
      at('2026-10-24T10:05:00+02:00', { counter: 6000, uptimeS: 299 }),
    ]);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'energy_unknown', reason: 'power_loss' }),
    ]);
    expect(result.days[0]?.energyKwh).toBe(0);
  });

  it('accepts uptime equal to the interval length', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { counter: 0 }),
      at('2026-10-24T10:05:00+02:00', { counter: 1000, uptimeS: 300 }),
    ]);
    expect(result.events).toEqual([]);
    expect(result.days[0]?.energyKwh).toBeCloseTo(1, 9);
  });

  it('counts a counter rollover with a counter_rollover event', () => {
    const result = buildReport([
      at('2026-10-25T04:40:01+01:00', { counter: 0xffffffe0, sf: 1 }),
      at('2026-10-25T04:45:01+01:00', { counter: 47, sf: 1 }),
    ]);
    expect(result.events).toEqual([
      {
        meter: 'M1',
        type: 'counter_rollover',
        from: Date.parse('2026-10-25T04:40:01+01:00'),
        to: Date.parse('2026-10-25T04:45:01+01:00'),
      },
    ]);
    expect(result.days[3]?.energyKwh).toBeCloseTo(0.79, 9);
  });

  it('emits both gap and counter_rollover for a rollover inside a gap', () => {
    const result = buildReport([
      at('2026-10-25T04:00:00+01:00', { counter: 0xffffffe0 }),
      at('2026-10-25T04:30:00+01:00', { counter: 47 }),
    ]);
    expect(result.events.map((e) => e.type).sort()).toEqual(['counter_rollover', 'gap']);
  });

  it('gives 0 energy and energy_unknown for a non-rollover decrease', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { counter: 5000 }),
      at('2026-10-24T10:05:00+02:00', { counter: 1000 }),
    ]);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'energy_unknown', reason: 'counter_decrease' }),
    ]);
    expect(result.days[0]?.energyKwh).toBe(0);
    expect(result.days[0]?.intervals).toBe(1);
  });

  it('gives 0 energy and energy_unknown for a scale factor change', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { counter: 1000, sf: 0 }),
      at('2026-10-24T10:05:00+02:00', { counter: 2000, sf: 1 }),
    ]);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'energy_unknown', reason: 'scale_factor_change' }),
    ]);
    expect(result.days[0]?.energyKwh).toBe(0);
  });
});

describe('buildReport peak power', () => {
  it('takes the maximum valid power of the day', () => {
    const readings = [
      at('2026-10-24T10:00:00+02:00', { powerW: 100 }),
      at('2026-10-24T10:05:00+02:00', { powerW: 300 }),
      at('2026-10-24T10:10:00+02:00', { powerW: 200 }),
    ];
    expect(day(readings, '2026-10-24').peak).toEqual({
      powerW: 300,
      at: Date.parse('2026-10-24T10:05:00+02:00'),
    });
  });

  it('keeps the earliest instant on a tie', () => {
    const readings = [
      at('2026-10-24T10:00:00+02:00', { powerW: 300 }),
      at('2026-10-24T10:05:00+02:00', { powerW: 300 }),
    ];
    expect(day(readings, '2026-10-24').peak?.at).toBe(Date.parse('2026-10-24T10:00:00+02:00'));
  });

  it('accepts a negative power as the peak when it is the only value', () => {
    expect(day([at('2026-10-24T10:00:00+02:00', { powerW: -5 })], '2026-10-24').peak?.powerW).toBe(
      -5,
    );
  });

  it('excludes invalid power from the peak and counts it', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { powerW: 50 }),
      at('2026-10-24T10:05:00+02:00', { powerW: null }),
    ]);
    expect(result.invalidPowerReadings).toBe(1);
    expect(result.days[0]?.peak?.powerW).toBe(50);
  });

  it('has a null peak when no value is valid', () => {
    const result = buildReport([
      at('2026-10-24T10:00:00+02:00', { powerW: null }),
      at('2026-10-24T10:05:00+02:00', { powerW: null }),
    ]);
    expect(result.days[0]?.peak).toBeNull();
    expect(result.invalidPowerReadings).toBe(2);
  });

  it('keeps one peak per day', () => {
    const readings = [
      at('2026-10-24T23:55:00+02:00', { powerW: 900 }),
      at('2026-10-25T00:00:00+02:00', { powerW: 10 }),
    ];
    expect(day(readings, '2026-10-24').peak?.powerW).toBe(900);
    expect(day(readings, '2026-10-25').peak?.powerW).toBe(10);
  });
});

describe('buildReport window', () => {
  it('always returns 9 rows in date then meter order', () => {
    const rows = buildReport([]).days.map((d) => `${d.date} ${d.meter}`);
    expect(rows).toEqual([
      '2026-10-24 M1',
      '2026-10-24 M2',
      '2026-10-24 M3',
      '2026-10-25 M1',
      '2026-10-25 M2',
      '2026-10-25 M3',
      '2026-10-26 M1',
      '2026-10-26 M2',
      '2026-10-26 M3',
    ]);
  });

  it('ignores readings and intervals outside the report days', () => {
    const result = buildReport([
      at('2026-10-23T12:00:00+02:00', { powerW: null }),
      at('2026-10-23T23:55:00+02:00', { counter: 0, powerW: null }),
      at('2026-10-27T12:00:00+01:00', { counter: 0, powerW: null }),
      at('2026-10-27T13:00:00+01:00', { counter: 0xffffffe0, uptimeS: 1 }),
    ]);
    expect(result.events).toEqual([]);
    expect(result.invalidPowerReadings).toBe(0);
    expect(result.days.reduce((sum, d) => sum + d.energyKwh, 0)).toBe(0);
    expect(result.days.reduce((sum, d) => sum + d.intervals, 0)).toBe(0);
  });

  it('attributes the last interval of 2026-10-26 to that day', () => {
    const readings = [
      at('2026-10-26T23:55:00+01:00', { counter: 0 }),
      at('2026-10-27T00:00:00+01:00', { counter: 1000 }),
    ];
    expect(day(readings, '2026-10-26').intervals).toBe(1);
    expect(day(readings, '2026-10-26').energyKwh).toBeCloseTo(1, 9);
  });
});

describe('fw_msg', () => {
  function line(seqNo: number, ts: string, counter: number, fwMsg: string): string {
    return JSON.stringify({
      gw_seq: seqNo,
      ts,
      meter: 'M2',
      unit_id: 2,
      fc: 3,
      start_addr: 100,
      qty: 7,
      regs: [0, 0x4000, counter, 0, 1, 1000, 0],
      fw_msg: fwMsg,
    });
  }

  function reportFor(messages: string[]): Report {
    const text = [
      line(1, '2026-10-24 10:00:00', 1000, messages[0] ?? ''),
      line(2, '2026-10-24 10:05:00', 2000, messages[1] ?? ''),
    ].join('\n');
    const parsed = parseTelemetry(text);
    const resolved = resolveReadings(parsed.records);
    return formatReport(buildReport(resolved.readings), parsed.findings, parsed.duplicatesDropped);
  }

  it('leaves every number unchanged whatever fw_msg says, including the SF=2 message', () => {
    const plain = reportFor(['OK', 'OK']);
    const noisy = reportFor(['OK', 'SF register misreports, use SF=2']);
    expect(noisy).toEqual(plain);
    expect(plain.daily[1]?.energy_kwh).toBe(10);
  });
});
